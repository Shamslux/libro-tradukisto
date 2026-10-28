![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white) ![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB) ![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white) ![Tauri](https://img.shields.io/badge/Tauri-FFC107?style=for-the-badge&logo=tauri&logoColor=white) ![Vite](https://img.shields.io/badge/Vite-B73BFF?style=for-the-badge&logo=vite&logoColor=FFD622)

<p align="center">
  <img src="src-ui/public/libro-tradukisto.png" alt="Libro Tradukisto Logo" width="160">
</p>

<h1 align="center">Libro Tradukisto</h1>

<p align="center">
  A desktop application for translating and reviewing EPUB books.
</p>

# Libro Tradukisto

**A desktop application for translating and reviewing EPUB books.**

Libro Tradukisto is an open-source project being rebuilt as a native desktop application using Tauri, Rust, React, and TypeScript.

The project aims to provide a practical environment for importing EPUB books, translating their contents, reviewing translated text, and exporting edited EPUB files.

> **Development status: Experimental (v0.1.0)**
>
> The desktop application is under active development. EPUB structure preservation, translation workflows, and compatibility with different EPUB readers still require additional validation. This version should not be considered production-ready.

## Features

The current desktop implementation includes:

- EPUB import and content processing.
- Text translation through supported translation engines.
- An interface for reviewing and editing translated content.
- EPUB export functionality.
- Multilingual application interface.
- Light and dark themes.
- First-run onboarding and an interactive application tour.
- An About dialog and an application update interface.
- Windows installer generation using NSIS.

Some features may be incomplete or behave differently depending on the EPUB file and translation provider.

## Technology Stack

| Component | Technology |
|---|---|
| Desktop framework | Tauri v2 |
| Native backend | Rust |
| Frontend | React 19 |
| Programming languages | TypeScript and Rust |
| Frontend build tool | Vite 6 |
| Package management | npm workspaces |
| Windows installer | NSIS |
| Application updates | Tauri Updater |

## Project Structure

```text
libro-tradukisto/
├── src-core/       # EPUB processing and translation engines
├── src-ui/         # React user interface
├── src-tauri/      # Rust backend and Tauri configuration
├── assets/         # Project assets
├── package.json    # npm workspace configuration
└── README.md
```

## Installation

The desktop application is currently in an experimental stage.

When Windows installers are published, they will be available on the [GitHub Releases](https://github.com/Shamslux/libro-tradukisto/releases) page.

**Important:** Back up your original EPUB files before testing the application. Do not rely on experimental exports as your only copy of a book.

## Development

### Prerequisites

To develop and build the Windows desktop application, install:

- Node.js and npm.
- Rust and Cargo.
- Microsoft C++ Build Tools with the Windows C++ development components.
- Microsoft Edge WebView2 Runtime.

Additional platform-specific prerequisites may be required. Refer to the [Tauri v2 prerequisites documentation](https://v2.tauri.app/start/prerequisites/).

### Clone the repository

```bash
git clone https://github.com/Shamslux/libro-tradukisto.git
cd libro-tradukisto
```

### Install dependencies

```bash
npm install
```

### Run the desktop application in development mode

```bash
npm run tauri:dev
```

### Build the TypeScript packages

```bash
npm run build
```

### Build the Windows installer

```bash
npm run tauri:build -- --bundles nsis
```

The Windows installer is generated under:

```text
src-tauri/target/release/bundle/nsis/
```

**Signed updater builds:** The project is configured to generate updater artifacts. Producing signed update packages requires the maintainer's private signing key and signing credentials. These credentials must never be committed to the repository.

## Application Updates

Libro Tradukisto includes an update-checking interface based on the Tauri Updater plugin.

The application is configured to retrieve update metadata from GitHub Releases using a `latest.json` manifest.

Automatic updates will only be fully operational once compatible signed releases and their update metadata are published and successfully tested.

## Known Limitations

The desktop application remains under active development.

Areas requiring additional testing and improvement include:

- EPUB structural integrity after translation and export.
- Validation of generated EPUB files using EPUBCheck and EPUB readers.
- Review and editing workflows for books with many text segments.
- Compatibility across different EPUB layouts and structures.
- Translation engine behavior and error handling.
- End-to-end validation of signed application updates.

Successful compilation or installer generation does not guarantee correct processing of every EPUB file.

## Legacy Version

The original Python/Streamlit implementation is preserved in the [`Libro-Tradukisto-Legacy`](https://github.com/Shamslux/libro-tradukisto/tree/Libro-Tradukisto-Legacy) branch.

The current desktop version is a separate architectural evolution of the project.

## Contributing

Issues, bug reports, and suggestions are welcome.

When reporting EPUB-related problems, please describe the steps needed to reproduce the issue. Avoid uploading copyrighted books without permission.

## License

See the [LICENSE](LICENSE) file for the project's licensing terms.

---

**Libro Tradukisto** — An experimental desktop EPUB translation project.