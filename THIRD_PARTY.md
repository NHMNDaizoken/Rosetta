# Third-party inventory

This foundation has no npm dependencies and copies no third-party application
source. Entries below describe development/runtime components; they do not
approve a project license. Project distribution remains blocked pending the
decisions in [docs/LICENSING.md](docs/LICENSING.md).

| Component | Version | Upstream and license | Use and obligations |
| --- | --- | --- | --- |
| Node.js | 24.x; target 24.21.0 in `.node-version` | [Upstream](https://nodejs.org/), [license and bundled notices](https://github.com/nodejs/node/blob/v24.21.0/LICENSE); Node.js code is MIT, bundled components have additional terms | Runtime and built-in HTTP/test tooling. Native runtime is installed separately. Preserve upstream license and bundled notices when redistributing it; review the complete runtime inventory before release. |

There is no npm install step or lockfile because the package has no dependency
graph. New packages, service images or borrowed assets require inventory updates
and license review before use. This inventory is not a vulnerability or license
audit of the host operating system.
