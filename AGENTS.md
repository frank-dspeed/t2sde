# AGENTS.md — T2 SDE Master System Reference & Operating Rules

Exhaustive, zero-lookup reference for AI coding agents working in the T2 SDE tree. Eliminates the need to read `README.md` or grep `scripts/functions.in` for standard syntax.

---

## 1. CLI & Filesystem Reference

### Core Commands
* **Build specific stage & pkg:** `./t2 build-target -cfg <cfg> <stage>-<pkg>`
* **Build single pkg (auto-stage):** `./t2 build -cfg <cfg> <pkg>`
* **Build full target:** `./t2 build-target -cfg <cfg>`
* **Download sources:** `./t2 download <pkg>` (or `-all`)
* **Update checksums (`[D]`):** `./t2 update-cksum <pkg>`
* **Create new pkg:** `./t2 create <url>`
* **Upgrade pkg version:** `./t2 up <pkg> <new_ver>`
* **Clean build failures/state:** `./t2 clean -cfg <cfg>`

### Key Tree & Build Paths
* **Package definition:** `package/<repo>/<pkg>/<pkg>.desc`
* **Dependency/Scheduler cache:** `package/<repo>/<pkg>/<pkg>.cache`
* **Package patches:** `package/<repo>/<pkg>/*.patch`
* **Build error log ( active/failed ):** `build/<cfg>-*/var/adm/logs/<stage>-<pkg>.err`
* **Build success log:** `build/<cfg>-*/var/adm/logs/<stage>-<pkg>.log`
* **Installed package manifest:** `build/<cfg>-*/var/adm/packages/<pkg>`
* **File list (`flist`):** `build/<cfg>-*/var/adm/flists/<pkg>`
* **Target sysroot:** `build/<cfg>-*/`
* **Host cross-toolchain & native helpers:** `build/<cfg>-*/TOOLCHAIN/cross/`
* **Core build engine:** `scripts/functions.in`, `scripts/Build-Pkg`, `scripts/Build-Target`, `scripts/parse-config`

---

## 2. Build Stages (`[P]` Tag & `atstage`)

| Stage | `atstage` Check | Purpose / Execution Context |
| :--- | :--- | :--- |
| **`0`** | `atstage toolchain` | **Host/Bootstrap.** Built natively on the host OS. Installed into `build/<cfg>-*/TOOLCHAIN/cross`. Used for cross-compilers, build tools (`cmake`, `meson`), and native code generators (`meinproc6`, `protocolgen`). |
| **`1`** | `atstage cross` (or `crossbuild`) | **Cross-Bootstrap.** Core minimal libraries/binaries cross-compiled for the target architecture to bootstrap the sysroot. |
| **`2`** | `atstage cross` (or `crossbuild`) | **Main Cross-Build.** Standard cross-compilation stage for the vast majority of target packages. Target binaries **cannot** be executed on the build host during this stage. |
| **`3`–`4`** | `atstage native` | **Chroot / Native Bootstrap.** Rebuilding core toolchain inside the target environment (if building natively/chroot). |
| **`5`** | `atstage native` | **Full Native Build.** Building standard packages natively inside the target system. |
| **`9`** | `atstage rebuild` | **Final Rebuild / Cleanup.** Final pass for self-hosting verification. |

* **`[P]` Priority String Syntax:** `<X|O> <0123456789> <###.###>`
  * `X` = Enabled by default; `O` = Disabled by default.
  * `0123456789` = Active stages (`-` = disabled for that stage, digit = enabled). Example: `X -1---5---9 120.500` runs in stages 1, 5, and 9. To enable host helper build in stage 0, change first slot to `0` (`X 01---5---9 ...`).
  * `###.###` = Topological sort weight (lower builds earlier).

---

## 3. `.desc` Metadata Tags Reference

All tags must remain at the top of `<pkg>.desc` in standard order. **Never place shell code between tags.**

| Tag | Name | Syntax / Rules |
| :--- | :--- | :--- |
| `[I]` | Title | Short 1-line summary (no trailing period). |
| `[T]` | Text | Multi-line description of the package. |
| `[U]` | URL | Upstream homepage URL. |
| `[A]` | Author | Upstream author/organization. |
| `[M]` | Maintainer | T2 maintainer name/email. |
| `[C]` | Category | Primary/secondary category (e.g., `base/system`, `extra/development`). |
| `[F]` | Flags | Space-separated build flags (see Section 4). |
| `[E]` | Explicit Dep | `[E] add <pkg>` (hard dep) or `[E] opt <pkg>` (optional dep). Can restrict by stage: `[E] add <pkg> cross`. |
| `[R]` | Arch Restrict | `+ <arch>` (whitelist) or `- <arch>` (blacklist), e.g., `[R] - avr32 blackfin`. |
| `[L]` | License | `GPL`, `LGPL`, `MIT`, `BSD`, `MPL`, `Apache`, `OpenSource`, etc. |
| `[S]` | Status | `Stable`, `Beta`, `Alpha`, `Experimental`. |
| `[V]` | Version | Upstream version string. |
| `[P]` | Priority | `<X|O> <stages> <weight>` (see Section 2). |
| `[O]` | Conf Directives | Optional shared include/config directives. |
| `[D]` | Download | `<cksum> <filename> <url>`. Use `0` as cksum before running `./t2 update-cksum <pkg>`. |

---

## 4. `[F]` Flags Reference

* **`CROSS`**: Package supports cross-compilation (stages 1/2).
* **`NO-LTO`**: Disable Link-Time Optimization (use when package fails with LTO linker errors/ICEs).
* **`NO-PIE` / `NO-SSP`**: Disable Position Independent Executables or Stack Smashing Protector.
* **`OBJECDIR`**: Build out-of-tree in a dedicated `objdir` directory (automatically enabled by `cmake`/`meson`, useful for picky autotools/GCC builds).
* **`FPIC`**: Force `-fPIC` across compilation.
* **`J1`**: Disable parallel `make` (`-j1`) for packages with broken Makefile race conditions.
* **`AUTOMAKE-QUIRK`**: Bypass strict automake version checks.
* **`DIETLIBC` / `UCLIBC` / `MUSL`**: Compatibility markers for alternative C libraries.

---

## 5. Build Variables, Helpers & Execution Hooks

All custom shell logic goes at the **very bottom** of `<pkg>.desc` after `[D]`.

### Variable Manipulation (`var_append` / `var_insert` / `var_remove` / `var_remove_regex`)
Never overwrite global option variables directly (`confopt="--foo"` wipes defaults). Always mutate:
* `var_append <var> '<sep>' '<value>'` — Append to end (e.g., `var_append confopt ' ' --disable-nls`)
* `var_insert <var> '<sep>' '<value>'` — Prepend to start (e.g., `var_insert GCC_WRAPPER_INSERT ' ' -I$root/usr/include`)
* `var_remove <var> '<sep>' '<value>'` — Remove exact match
* `var_remove_regex <var> '<sep>' '<regex>'` — Remove by pattern (e.g., `var_remove_regex makeopt ' ' 'CC=.*'`)

### Core Build Variables

| Variable | Build System / Scope | Default / Usage |
| :--- | :--- | :--- |
| `confopt` | Autotools (`./configure`), CMake (`cmake`), Meson (`meson`) | Auto-populated; T2 intercepts `--enable-*`/`--with-*` or `-D*` depending on active generator. |
| `extraconfopt` | Autotools | Appended to `confopt`. |
| `makeopt` | `make` / `ninja` | Flags passed during build phase (`runmake=1`). Set `makeopt=` to skip build step or override targets. |
| `makeinstopt` | `make install` / `ninja install` | Flags passed during install phase (`DESTDIR=$root` handled automatically). Set `makeinstopt=` to skip default install. |
| `autogen` | Autotools | `autogen=1` runs `autoreconf`/autogen scripts before `configure`. |
| `runconf` | `./configure` | Set `runconf=0` to skip `./configure`. |
| `runcmake` | CMake | Set `runcmake=0` to disable automatic `cmake` invocation if package has both `CMakeLists.txt` and `Makefile`. |
| `runmeson` | Meson | Set `runmeson=0` to disable automatic `meson` invocation. |
| `rungpepinstall`| Python PEP517 | Set `rungpepinstall=0` to disable default PEP517 wheel build/install. |
| `runmake` | `make` | Set `runmake=0` to disable default `make` and `make install` runs. |
| `srcdir` | Source extraction | Subdirectory inside tarball (`srcdir=foo-$ver/src`). |
| ` patchfiles` | Patch application | Space-separated list of patches (`var_append patchfiles ' ' $confdir/extra.patch`). |
| `GCC_WRAPPER_APPEND` | Compiler wrapper | Append flags directly to `gcc`/`clang` calls (`var_append GCC_WRAPPER_APPEND ' ' -Wno-error=incompatible-pointer-types`). |
| `GCC_WRAPPER_INSERT` | Compiler wrapper | Prepend flags to compiler calls. |
| `GCC_WRAPPER_REMOVE` | Compiler wrapper | Strip problematic flags injected by upstream Makefiles (`var_append GCC_WRAPPER_REMOVE ' ' -Werror`). |

### Path & Environment Variables (Available in `.desc` Script Body)
* `$root` — Sandbox destination prefix (`""` in native stage 5, `build/<cfg>-*` in cross stages 1/2). **Always prefix target install paths with `$root` (e.g., `$root$bindir`, `$root$libdir`, `$root/etc`).**
* `$prefix` — Package prefix (usually `/usr` or `usr` depending on context; `$root/$prefix` is safe).
* `$bindir`, `$sbindir`, `$libdir`, `$includedir`, `$datadir`, `$docdir`, `$sysconfdir` — Standard FHS paths (already include leading `/`, so use `$root$libdir`).
* `$base` — Root of the T2 SDE source tree.
* `$confdir` — Directory of the current package (`package/<repo>/<pkg>`).
* `$builddir` — Temporary build workspace where tarballs are unpacked.
* `$arch_target` / `$arch_build` — Target vs. host GNU triplets (e.g., `aarch64-t2-linux-gnu` vs. `x86_64-t2-linux-gnu`).
* `$CC`, `$CXX`, `$AR`, `$RANLIB`, `$LD`, `$STRIP` — Target tool binaries (automatically point to cross-tools in stages 1/2).
* `$HOSTCC`, `$HOSTCXX` — Native build-host compiler (`gcc`, `g++`).

### Execution Hooks (`hook_add <hook> <priority> "<command>"`)
Priority `1`–`9` (`5` is standard). Execution order:
1. `prepauto` — Before unpacking sources.
2. `prepatch` — After unpack, before applying `.patch` files.
3. `postpatch` — After applying patches, before autogen/configure (ideal for `sed` fixes on `CMakeLists.txt` or `configure.ac`).
4. `preconf` — Right before `./configure` / `cmake` / `meson`.
5. ` premake` — After configure, before `make` / `ninja`.
6. `inmake` — During build, right after `make` completes, before `make install`.
7. `postmake` — After `make install` completes (ideal for installing extra binaries, symlinks, or fixing file permissions in `$root`).
8. `postdoc` — After documentation compression/handling.
9. `postflist` — At the very end after file list generation.

### Helper Functions (`scripts/functions.in`)
* `pkginstalled <pkgA> [pkgB ...]` — Returns `0` (true) only if **all** specified packages are installed in the target. Automatically registers each argument as `[OPT]` in `.cache`.
* `pkgprefix [-t] <var> <pkg>` — Queries prefix/path metadata of an installed package (`pkgprefix libdir libx11`). Remember to run `pkginstalled <pkg>` before calling `pkgprefix` if the dependency is optional.
* `atstage <stage_name>` — Returns `0` if currently building in `<toolchain|cross|native|rebuild>`.

---

## 6. Non-Negotiable Core Rules

1. **Disk Space Gate:** Run `df -h` before any single or batch build. Abort immediately if free space is `< 8 GB`. Disk-full conditions cause truncated installs and silent toolchain corruption.
2. **Real Cross-Compile Fixes Only:** Never blindly disable configure checks or hardcode host paths (`/usr/include`, `/usr/lib`) to bypass missing target dependencies.
3. **Mandatory Build & Verification:** Never declare a package fixed without running a test build. Post-build verification checklist:
   * Check `build/<cfg>-*/var/adm/packages/<pkg>`: If size is `0.00 MB` with ~5–7 files, it is a **phantom install** (only metadata files exist; `fl_wrapper.so` blocked host writes or `--destdir` was omitted).
   * Test the resulting binaries/modules directly where feasible (`python -c "import <mod>"`, `<tool> --version`).
4. **Native Build Helpers (`stage 0`):** Target binaries built in stage 1/2 cannot run on the build host. If a package executes its own compiled binary during build (`meinproc6`, `protocolgen`, `wayland-scanner`, `glib-compile-schemas`):
   * Either compile the small helper tool inside `premake` using `$HOSTCC`, OR
   * Enable stage `0` in `[P]` (`X 01---5---9 ...`) so T2 builds a native version into `TOOLCHAIN/cross` first, and pass the host tool path (`-DKF6_HOST_TOOLING=...`, `-DQT_HOST_PATH=...`) during `atstage cross`.

---

## 7. `.desc` & `.cache` Dependency Laws

1. **Grep `.cache` BEFORE adding `[E]`:** Always run `grep <dep> package/*/<pkg>/<pkg>.cache` first.
   * **If already in `.cache`:** **DO NOT** add `[E] add/opt <dep>` to `.desc`. The dependency is already tracked; adding `[E]` is no-op noise. The real failure is an unbuilt target package, version skew, or a build script bug.
   * **If missing from `.cache`:** Add `[E] add <dep>` (or `[E] opt <dep>`) to `<pkg>.desc` **AND** immediately add `[DEP] <dep>` (or `[OPT] <dep>`) to `<pkg>.cache`. The build scheduler reads `.cache` exclusively; `.desc`-only edits have zero effect on bulk target build ordering until `.cache` is updated.
2. **Use `pkginstalled` for Optional Features:**
   * Never unconditionally disable features just to make a build pass. Gate them:
     `pkginstalled foo || var_append confopt ' ' --disable-foo`
   * Use multi-arg AND-gates instead of nested `if` statements:
     `pkginstalled pkgA pkgB || var_append confopt ' ' -DENABLE_FEATURE=OFF`
   * **No Redundant `[E] opt`:** Because `pkginstalled` dynamically registers `[OPT]` in `.cache`, never add a static `[E] opt <pkg>` line for any package already queried via `pkginstalled`.
3. **Use `autogen=1`, Not Custom Hooks:** If a tarball ships `configure.ac`/`Makefile.am` without `configure`, put `autogen=1` at the bottom of `.desc`. Never write `hook_add preconf 5 "autoreconf -fi"`.
4. **Preserve `.cache` Updates:** When a successful build updates `<pkg>.cache` with valid new dependencies, include the updated `.cache` in your changes.

---

## 8. Code Style, Patches & Attribution

* **Minimal Comments:** Do not add comments explaining obvious 1-liners or `pkginstalled`/`atstage` conditionals. When a comment is strictly necessary for a non-obvious workaround, keep it to 1–2 short lines.
* **Zero Inline Attribution:** Never include maintainer or agent names/emails in `.desc` or `.patch` comments (no `# René Rebe: ...`). Attribution belongs exclusively in commit messages.
* **Headers & Whitespace:** Preserve standard T2 copyright headers generated by `t2 create`. Never introduce unrelated whitespace, tab, or newline diffs.
* **Patch Standards:**
  * Must apply cleanly at `-p1`.
  * Format as `diff -u` / `svn diff` with enough context so the affected function signature appears in the `@@` hunk header.
  * Never include `Signed-off-by:` or extra copyright blocks inside `.patch` files.
  * Name temporary compiler/API fixes `hotfix-<short-topic>.patch` (e.g., `hotfix-gcc14.patch`). Keep filenames short.

---

## 9. Diagnostic Playbook & Common Root Causes

### Triage Workflow
1. **Inspect raw `.err` logs:** Never diagnose from `list-errors` 1-line summaries (they truncate the actual compiler/CMake error). Read `build/<cfg>-*/var/adm/logs/<stage>-<pkg>.err`.
2. **Cluster systemic failures:** When multiple packages fail in a batch build, extract the last error lines across `.err` files, normalize, and run `sort | uniq -c`. Fix shared infrastructure bugs once in `scripts/functions.in`, `scripts/parse-config`, or core library packages rather than patching 30 leaf packages.

### Recurring Failure Signatures
* **Sandbox Violations (`fl_wrapper.so: write outside basedir`) & Phantom Installs:**
  * **Cause:** Build system ignores `DESTDIR` or `--destdir` and writes directly into host `/usr`. `fl_wrapper.so` blocks the write, leaving a `0.00 MB` package.
  * **Fix:** Pass `$root` explicitly (e.g., for PEP517: `python -m installer --destdir="$root" .dist/*.whl` in `scripts/functions.in`; for custom Makefiles: `var_append makeinstopt ' ' PREFIX=$root/$prefix`).
* **Python PEP517 Bootstrap Circularity (`python-installer`, `python-flit-core`):**
  * **Cause:** Standard `rungpepinstall` runs `python -m installer .dist/*.whl`, which fails when building `python-installer` itself.
  * **Fix:** Bypass `rungpepinstall`:
    ```sh
    rungpepinstall=0 runmake=0
    hook_add premake 5 "gpep517 build-wheel --wheel-dir .dist --output-fd 1"
    hook_add inmake 5 "python3 -c \"import zipfile, sysconfig; zipfile.ZipFile('.dist/foo.whl').extractall(sysconfig.get_path('purelib'))\""
    ```
    *(Ensure target `purelib` path is prefixed with `$root` during cross stages).*
* **KDE Frameworks (KF6) / Applications Version Skew:**
  * **Symptom:** `Could NOT find KF6Foo ... (found suitable version "6.29.0", minimum required is "6.30.0")`.
  * **Cause:** Tree-wide `.desc` version bump occurred after lower-level dependencies were already built at the older version.
  * **Fix:** Not a `.desc` bug. Find all stale installed packages by comparing `head -n1 build/<cfg>-*/var/adm/packages/<pkg>` against `grep '^\[V\]' package/*/<pkg>/<pkg>.desc`, then rebuild stale packages in topological order (`./t2 build-target -cfg <cfg> 2-<pkg>`).
* **Cross-Compile Header / Library Leakage (`-I/usr/include` or `-L/usr/lib`):**
  * **Symptom:** Linker errors (`skipping incompatible /usr/lib/libfoo.so` or `file in wrong format`) or host header poisoning during stage 1/2.
  * **Fix:** Remove hardcoded host paths via `GCC_WRAPPER_REMOVE` or patch `CMakeLists.txt`/`Makefile` to use `$SYSROOT` / `pkg-config` properly.
* **Dead Upstream `[D]` URLs (404 / 407 / Timeout):**
  * **Cause:** Upstream domain moved or shut down (`docbook.org` -> `archive.docbook.org` / `oasis-open.org`; `pagure.io` archives -> `releases.pagure.org`).
  * **Fix:** Locate a verified, live upstream mirror, update `[D]`, and verify with `./t2 download <pkg>`. Never guess URLs or fabricate checksums.

---

## 10. Multi-Agent Concurrency Protocol

When multiple agents or sub-workers operate on the same T2 tree concurrently:
* **Strict Package Partitioning:** Each worker must own a disjoint set of packages. Never edit or build a package assigned to another active worker.
* **Shared Infrastructure Lock:** If a worker discovers a bug in `scripts/functions.in`, `scripts/parse-config`, or a core stage-0 toolchain package, coordinate before modifying global scripts to avoid breaking active builds.
* **Tolerate Config Races:** Expect transient lock/race conditions on shared config state (`config/<cfg>/*`); retry safely without overwriting concurrent state.
* **Continuous Disk Monitoring:** Every parallel worker must verify `df -h` before launching large build jobs (`libreoffice`, `llvm`, `rust`, `gcc`, `chromium`, `qt6base`).

## 11. Build-System Specific `.desc` Patterns & Variables

T2 auto-detects build systems via helper scripts (`package/*/cmake/cmake.conf`, `meson.conf`, `cargo-c.conf`, `go.conf`, `python-conf.in`). Override or extend them at the bottom of `<pkg>.desc` using these exact idioms.

### CMake (`CMakeLists.txt`)
* **Auto-detection:** Triggered when `CMakeLists.txt` exists (`runcmake=1` by default). Builds out-of-tree in `objs/` automatically (`OBJECDIR` implied).
* **Options:** Append `-D` flags directly to `confopt` (or `extraconfopt`).
* **Disabling CMake:** If a package ships both `CMakeLists.txt` and `Makefile`/`meson.build` and you want the other build system, set `runcmake=0`.
* **Cross-Compile Host Tools (Qt6 / KF6 / LLVM / Protobuf):**

```sh
  # Gate optional CMake dependencies
  pkginstalled wayland || var_append confopt ' ' -DENABLE_WAYLAND=OFF
  pkginstalled systemd polkit || var_append confopt ' ' -DBUILD_DAEMON=OFF

  # Point cross builds to stage-0 native host tools
  if atstage cross; then
      var_append confopt ' ' "-DKF6_HOST_TOOLING=$root/TOOLCHAIN/cross/lib/cmake"
      var_append confopt ' ' "-DQT_HOST_PATH=$root/TOOLCHAIN/cross"
      var_append confopt ' ' "-DProtobuf_PROTOC_EXECUTABLE=$root/TOOLCHAIN/cross/bin/protoc"
  fi

  # Bypass try_run() checks that fail in cross-compilation
  atstage cross && var_append confopt ' ' "-DHAVE_POLL_FINE_EXITCODE=0"

```

### Meson (`meson.build`)

* **Auto-detection:** Triggered when `meson.build` exists (`runmeson=1`). Uses `ninja` automatically.
* **Options:** Append `-Dkey=value` to `confopt` (or `mesonopt` where defined).
* **Cross-Compilation:** T2 generates `cross.ini` automatically during `atstage cross`.
```sh
# Gate features (Meson uses true/false or enabled/disabled/auto)
pkginstalled gobject-introspection || var_append confopt ' ' -Dintrospection=disabled
pkginstalled gtk-doc || var_append confopt ' ' -Dgtk_doc=false

# GObject-Introspection (gir) commonly fails in cross builds without qemu wrapper
atstage cross && var_append confopt ' ' -Dgir=false

```



### Autotools (`configure` / `configure.ac`)

* **Auto-detection:** Triggered by `configure` (`runconf=1`).
* **Missing `configure`:** Set `autogen=1` (runs `autoreconf -fi`).
* **Cross-Compile Cache (`config.cache`):** When `AC_RUN_IFELSE` fails during `atstage cross`, inject `ac_cv_*` cache variables into `confopt` or `extraconfopt`:
```sh
autogen=1
pkginstalled openssl || var_append confopt ' ' --without-ssl
atstage cross && var_append confopt ' ' "ac_cv_func_malloc_0_nonnull=yes ac_cv_file__dev_zero=yes"

```



### Rust / Cargo (`Cargo.toml`)

* **Auto-detection:** Triggered by `Cargo.toml` (`runcargo=1`).
* **Variables:**
* `cargopt`: Options passed to `cargo build` (default includes `--release`).
* `cargoinstopt`: Options passed to `cargo install`.


* **Cross-Compilation & Linking:** T2 sets `CARGO_BUILD_TARGET` to the target rust triplet in `atstage cross`.
* When `cargo install` doesn't fit (e.g., workspace builds, shared libraries via `cargo-c`, or custom assets), disable default install (`cargoinstopt=`) and install binaries manually from `target/$arch_target/release/` (cross) or `target/release/` (native) in `postmake`:


```sh
# Pass feature flags to cargo
pkginstalled libx11 || var_append cargopt ' ' --no-default-features
var_append cargopt ' ' "--features wayland"

# Manual binary install for workspace / custom targets
cargoinstopt=
if atstage cross; then
    hook_add postmake 5 "install -v -m 755 target/*-linux-*/release/mybin $root$bindir/"
else
    hook_add postmake 5 "install -v -m 755 target/release/mybin $root$bindir/"
fi

```



### Go (`go.mod` / `*.go`)

* **Auto-detection:** Triggered by `go.mod` (`rungo=1`).
* **Variables:** `goopt` (flags passed to `go build`). T2 automatically exports `GOOS`, `GOARCH`, `GOARM`, and `CGO_ENABLED` during cross builds.
* **CGO Cross-Compilation:** If the Go package links against C libraries (`CGO_ENABLED=1`), ensure `CC=$CC` and `PKG_CONFIG_PATH` are respected:
```sh
# Override target package path or ldflags
var_append goopt ' ' "-ldflags '-s -w -X main.version=$ver'"
var_append goopt ' ' ./cmd/mytool

# Custom Go build & install when standard go.conf flow doesn't match layout
rungo=0 runmake=0
hook_add inmake 5 "CGO_ENABLED=1 CC=$CC go build -v -o mytool ./cmd/mytool"
hook_add postmake 5 "install -v -m 755 mytool $root$bindir/"

```



### Python (`pyproject.toml` / `setup.py`)

* **Auto-detection:**
* `pyproject.toml` triggers `rungpepinstall=1` (`gpep517 build-wheel` + `python -m installer --destdir="$root" .dist/*.whl`).
* `setup.py` (without `pyproject.toml`) triggers `runpysetup=1`.


* **Cross-Compiled C Extensions (`pyo3` / `maturin` / `cython` / `cffi`):**
* Ensure `_PYTHON_SYSCONFIGDATA_NAME` and cross-compiler wrappers stay active.
* For Rust-backed Python wheels (`maturin`), pass target architecture flags via `gpep517` or `MATURIN_SETUP_ARGS`:


```sh
atstage cross && var_append GCC_WRAPPER_INSERT ' ' "-I$root$includedir/python3.*"

```



### Plain Makefile (No `configure` / `CMakeLists.txt`)

* **Auto-detection:** Runs `make $makeopt` and `make $makeinstopt` (`runmake=1`).
* **Common Fixes:** Plain Makefiles often hardcode `CC=gcc`, `PREFIX=/usr`, or ignore `DESTDIR`:
```sh
# Force cross tools and target prefix/destdir
var_append makeopt ' ' "CC=$CC CXX=$CXX AR=$AR PREFIX=/$prefix"
var_append makeinstopt ' ' "PREFIX=/$prefix DESTDIR=$root"

```


