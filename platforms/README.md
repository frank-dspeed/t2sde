This directory contains files you need to (cross-)compile the T2 SDE on
various platforms and architecture matrix Combinations. There is a module for each platform-architecture supported.
Such a directory contains at last this file:

${platform}-§{arch}/${platform}-§{arch}.ts 

Rules:
- using named exports only for static analytics
- only Strip able typescript syntax. [tsconfig.json#erasableSyntaxOnly](https://www.typescriptlang.org/tsconfig/#erasableSyntaxOnly)
