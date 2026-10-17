// T2sde only has linux at present
const platform = 'linux';
export const getArchitecture = (arch=process.arch) => {
  fs.readdir('../../architectures',{ rescusive: false }).find(arch => arch === process.arch)
//   This directory contains files you need to (cross-)compile the T2 SDE on
// various architectures. There is a subdir for each architecture supported.
// Such a directory can contain this files:

//   README                 Architecture dependent documentation

//   preconfig.in           For registering the arch in the SDE config system
//   config.in              Architecture dependent configuration
//   config.hlp             Arhcitecture dependent configuration help
  
//   archtest.out           Output of the archtest.c program
//   archtest.sh            Dynamic archtest values

//   kernel.conf.*          Linux kernel configuration

//   *cc-options.in         Compiler parameter configuration files
}


export interface T2Download {
  cksum: string;
  filename: string;
  url: string;
}

export interface T2Desc {
  title?: string;
  text: string[];
  url?: string;
  author?: string;
  maintainer?: string;
  category?: string;
  flags: string[];
  explicitDeps: string[];
  archRestrict: string[];
  license?: string;
  status?: string;
  version?: string;
  priority?: string;
  confDirectives: string[];
  downloads: T2Download[];
  scriptBody?: string;
}

/**
 * Fast single-pass parser for T2 SDE .desc package definition files.
 * high-performance, single-pass TypeScript parser designed specifically for 
 * T2 SDE .desc files. 
 * It runs in $O(N)$ time complexity (line-by-line streaming scan), correctly handles multi-line fields
 * ([T]), repeated multi-value entries ([E], [D]), and cleanly extracts trailing custom shell script logic.
 */
export function parseT2Desc(content: string): T2Desc {
  // Fast line splitting supporting both LF and CRLF
  const lines = content.split(/\r?\n/);
  const result: T2Desc = {
    text: [],
    flags: [],
    explicitDeps: [],
    archRestrict: [],
    confDirectives: [],
    downloads: [],
  };

  let currentTag: string | null = null;
  const scriptLines: string[] = [];
  let inScript = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Once we transition past metadata into shell script hooks/logic, accumulate remainder
    if (inScript) {
      scriptLines.push(line);
      continue;
    }

    // Fast regex match for metadata tags: [X] value
    const match = line.match(/^\[([A-Z])\]\s*(.*)$/);
    if (match) {
      currentTag = match[1];
      const val = match[2];

      switch (currentTag) {
        case 'I':
          result.title = val;
          break;
        case 'U':
          result.url = val;
          break;
        case 'A':
          result.author = val;
          break;
        case 'M':
          result.maintainer = val;
          break;
        case 'C':
          result.category = val;
          break;
        case 'L':
          result.license = val;
          break;
        case 'S':
          result.status = val;
          break;
        case 'V':
          result.version = val;
          break;
        case 'P':
          result.priority = val;
          break;
        case 'F':
          if (val) result.flags.push(...val.split(/\s+/).filter(Boolean));
          break;
        case 'E':
          if (val) result.explicitDeps.push(val);
          break;
        case 'R':
          if (val) result.archRestrict.push(val);
          break;
        case 'O':
          if (val) result.confDirectives.push(val);
          break;
        case 'D':
          if (val) {
            const parts = val.split(/\s+/);
            if (parts.length >= 3) {
              result.downloads.push({
                cksum: parts[0],
                filename: parts[1],
                url: parts.slice(2).join(' '),
              });
            }
          }
          break;
        case 'T':
          if (val) result.text.push(val);
          break;
      }
    } else {
      // Handle multi-line continuation or transition to script body
      if (currentTag === 'T') {
        result.text.push(line);
      } else if (result.downloads.length > 0 && line.trim() !== '') {
        // Anything after the [D] download block that isn't a tag is shell script code / hooks
        inScript = true;
        scriptLines.push(line);
      }
    }
  }

  if (scriptLines.length > 0) {
    result.scriptBody = scriptLines.join('\n').trim();
  }

  return result;
}

/** 
 * robust TypeScript implementation that parses T2 SDE .cache files, builds a full directed dependency graph 
 * combining both .desc and .cache data, and computes a correct topological build order 
 * (using Kahn's algorithm with cycle detection).
 **/
import { T2Desc } from './parse-t2-desc'; // assuming the parser from previous step

export interface T2Cache {
  dependencies: string[]; // [DEP] lines
  optionalDeps: string[]; // [OPT] lines
}

export interface PackageNode {
  name: string;
  desc: T2Desc;
  cache: T2Cache;
  dependencies: Set<string>; // packages this package depends on
  dependents: Set<string>;   // packages that depend on this package
}

export type DependencyGraph = Map<string, PackageNode>;

/**
 * Fast parser for T2 SDE .cache dependency files.
 */
export function parseT2Cache(content: string): T2Cache {
  const lines = content.split(/\r?\n/);
  const dependencies: string[] = [];
  const optionalDeps: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[DEP]')) {
      const dep = trimmed.replace(/^[DEP]\s*/, '').trim();
      if (dep) dependencies.push(dep);
    } else if (trimmed.startsWith('[OPT]')) {
      const opt = trimmed.replace(/^[OPT]\s*/, '').trim();
      if (opt) optionalDeps.push(opt);
    }
  }

  return { dependencies, optionalDeps };
}

/**
 * Builds a directed dependency graph across all packages.
 */
export function buildDependencyGraph(
  packageMap: Map<string, { desc: T2Desc; cache: T2Cache }>
): DependencyGraph {
  const graph: DependencyGraph = new Map();

  // 1. Initialize nodes
  for (const [name, { desc, cache }] of packageMap.entries()) {
    graph.set(name, {
      name,
      desc,
      cache,
      dependencies: new Set(),
      dependents: new Set(),
    });
  }

  // 2. Populate edges from .cache (primary scheduler truth) and fallback to .desc [E]
  for (const [name, node] of graph.entries()) {
    // Combine hard dependencies from cache and explicit desc deps
    const allDeps = new Set([
      ...node.cache.dependencies,
      ...node.desc.explicitDeps
        .map(dep => dep.replace(/^(add|opt)\s+/, '').trim())
        .filter(Boolean),
    ]);

    for (const depName of allDeps) {
      // If the dependency exists in our known package set, add the edge
      if (graph.has(depName)) {
        node.dependencies.add(depName);
        graph.get(depName)!.dependents.add(name);
      }
    }
  }

  return graph;
}

/**
 * Computes topological build order using Kahn's algorithm.
 * Throws an error if a circular dependency cycle is detected.
 */
export function topologicalSort(graph: DependencyGraph): string[] {
  const inDegree = new Map<string, number>();
  const queue: string[] = [];
  const result: string[] = [];

  // Initialize in-degrees (count of unresolved dependencies for each package)
  for (const [name, node] of graph.entries()) {
    inDegree.set(name, node.dependencies.size);
    if (node.dependencies.size === 0) {
      queue.push(name); // Zero dependencies can be built immediately
    }
  }

  // Process queue
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    const currentNode = graph.get(current)!;
    for (const dependent of currentNode.dependents) {
      const currentDegree = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, currentDegree);

      if (currentDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  // Cycle detection: if result doesn't contain all nodes, there is a cycle
  if (result.length !== graph.size) {
    const unresolved = Array.from(graph.keys()).filter(name => !result.includes(name));
    throw new Error(
      `Circular dependency detected! Could not resolve build order for: ${unresolved.join(', ')}`
    );
  }

  return result;
}
