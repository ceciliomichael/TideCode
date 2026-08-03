import type { IconType } from 'react-icons';
import {
  SiTypescript,
  SiJavascript,
  SiHtml5,
  SiCss,
  SiPython,
  SiCplusplus,
  SiC,
  SiSharp,
  SiGo,
  SiRust,
  SiRuby,
  SiPhp,
  SiSwift,
  SiR,
  SiJson,
  SiMarkdown,
  SiVuedotjs,
  SiSvelte,
  SiDart,
  SiScala,
  SiClojure,
  SiElixir,
  SiErlang,
  SiLua,
  SiGraphql,
  SiDocker,
  SiKotlin,
  SiSass,
  SiYaml,
  SiDotenv,
  SiGit,
  SiTerraform,
  SiEslint,
  SiPrettier,
  SiNodedotjs,
  SiSqlite,
  SiPerl,
  SiHaskell,
  SiApachegroovy,
  SiFsharp,
  SiOcaml,
  SiNim,
  SiZig,
  SiCmake,
  SiNginx,
  SiApache,
} from 'react-icons/si';
import { 
  VscFile,
  VscFileMedia,
  VscJson,
  VscMarkdown,
  VscCode,
  VscTerminalPowershell,
  VscSettings,
  VscShield,
  VscListFlat,
  VscTerminal,
  VscArchive,
  VscFileZip,
  VscDatabase,
  VscFileBinary,
  VscTextSize,
  VscPackage,
} from 'react-icons/vsc';
import { FaDatabase } from 'react-icons/fa6';
import { BsFilePdf, BsFileText, BsFileWord, BsFiletypeCsv } from 'react-icons/bs';

/**
 * File icon configuration with language-specific colors
 */
export interface FileIconConfig {
  icon: IconType;
  color: string;
  label: string;
}

/**
 * Language-specific icon mappings with distinctive colors
 */
export const LANGUAGE_ICONS: Record<string, FileIconConfig> = {
  // TypeScript/JavaScript
  ts: { icon: SiTypescript, color: '#3178c6', label: 'TypeScript' },
  tsx: { icon: SiTypescript, color: '#3178c6', label: 'TypeScript React' },
  js: { icon: SiJavascript, color: '#f7df1e', label: 'JavaScript' },
  jsx: { icon: SiJavascript, color: '#61dafb', label: 'React' },
  mjs: { icon: SiJavascript, color: '#f7df1e', label: 'JavaScript Module' },
  cjs: { icon: SiJavascript, color: '#f7df1e', label: 'JavaScript CommonJS' },

  // Web
  html: { icon: SiHtml5, color: '#e34c26', label: 'HTML' },
  htm: { icon: SiHtml5, color: '#e34c26', label: 'HTML' },
  css: { icon: SiCss, color: '#264de4', label: 'CSS' },
  scss: { icon: SiSass, color: '#cc6699', label: 'SCSS' },
  sass: { icon: SiSass, color: '#cc6699', label: 'Sass' },
  less: { icon: VscCode, color: '#1d365d', label: 'Less' },

  // Python
  py: { icon: SiPython, color: '#3776ab', label: 'Python' },
  pyw: { icon: SiPython, color: '#3776ab', label: 'Python' },
  pyi: { icon: SiPython, color: '#3776ab', label: 'Python Interface' },

  // Java/Kotlin
  java: { icon: VscCode, color: '#007396', label: 'Java' },
  kt: { icon: SiKotlin, color: '#7f52ff', label: 'Kotlin' },
  kts: { icon: SiKotlin, color: '#7f52ff', label: 'Kotlin Script' },

  // C/C++
  c: { icon: SiC, color: '#555555', label: 'C' },
  cpp: { icon: SiCplusplus, color: '#00599c', label: 'C++' },
  cc: { icon: SiCplusplus, color: '#00599c', label: 'C++' },
  cxx: { icon: SiCplusplus, color: '#00599c', label: 'C++' },
  h: { icon: SiC, color: '#555555', label: 'Header' },
  hpp: { icon: SiCplusplus, color: '#00599c', label: 'C++ Header' },

  // C#
  cs: { icon: SiSharp, color: '#239120', label: 'C#' },
  csx: { icon: SiSharp, color: '#239120', label: 'C# Script' },

  // Go
  go: { icon: SiGo, color: '#00add8', label: 'Go' },
  gomod: { icon: SiGo, color: '#00add8', label: 'Go Module' },
  gosum: { icon: SiGo, color: '#00add8', label: 'Go Checksum' },
  gowork: { icon: SiGo, color: '#00add8', label: 'Go Workspace' },

  // Rust
  rs: { icon: SiRust, color: '#dea584', label: 'Rust' },

  // Ruby
  rb: { icon: SiRuby, color: '#cc342d', label: 'Ruby' },
  erb: { icon: SiRuby, color: '#cc342d', label: 'Ruby ERB' },

  // PHP
  php: { icon: SiPhp, color: '#777bb4', label: 'PHP' },

  // Swift
  swift: { icon: SiSwift, color: '#fa7343', label: 'Swift' },

  // R
  r: { icon: SiR, color: '#276dc3', label: 'R' },
  rmd: { icon: SiR, color: '#276dc3', label: 'RMarkdown' },
  rproj: { icon: SiR, color: '#276dc3', label: 'R Project' },
  rdata: { icon: SiR, color: '#276dc3', label: 'R Data' },
  rds: { icon: SiR, color: '#276dc3', label: 'R Data Source' },

  // Shell/Scripts
  sh: { icon: VscCode, color: '#89e051', label: 'Shell' },
  bash: { icon: VscCode, color: '#89e051', label: 'Bash' },
  zsh: { icon: VscCode, color: '#89e051', label: 'Zsh' },
  fish: { icon: VscCode, color: '#89e051', label: 'Fish' },
  bat: { icon: VscTerminal, color: '#0078D6', label: 'Windows Batch' },
  cmd: { icon: VscTerminal, color: '#0078D6', label: 'Windows Batch' },
  vbs: { icon: VscTerminal, color: '#0078D6', label: 'VBScript' },
  
  // Git
  gitignore: { icon: SiGit, color: '#F05032', label: 'Git Ignore' },
  gitattributes: { icon: SiGit, color: '#F05032', label: 'Git Attributes' },
  gitmodules: { icon: SiGit, color: '#F05032', label: 'Git Modules' },

  // Infrastructure
  tf: { icon: SiTerraform, color: '#623CE4', label: 'Terraform' },
  tfvars: { icon: SiTerraform, color: '#623CE4', label: 'Terraform Variables' },

  // Config/Tooling
  vscode: { icon: VscCode, color: '#007ACC', label: 'VS Code' },
  eslint: { icon: SiEslint, color: '#4B32C3', label: 'ESLint' },
  prettier: { icon: SiPrettier, color: '#F7B93E', label: 'Prettier' },
  node: { icon: SiNodedotjs, color: '#339933', label: 'Node.js' },

  // PowerShell
  ps1: { icon: VscTerminalPowershell, color: '#5391FE', label: 'PowerShell' },
  psm1: { icon: VscTerminalPowershell, color: '#5391FE', label: 'PowerShell Module' },
  psd1: { icon: VscTerminalPowershell, color: '#5391FE', label: 'PowerShell Data' },

  // Config/Data
  json: { icon: SiJson, color: '#f7df1e', label: 'JSON' },
  jsonc: { icon: VscJson, color: '#f7df1e', label: 'JSON with Comments' },
  csv: { icon: BsFiletypeCsv, color: '#217346', label: 'CSV' },
  yaml: { icon: SiYaml, color: '#cb171e', label: 'YAML' },
  yml: { icon: SiYaml, color: '#cb171e', label: 'YAML' },
  toml: { icon: VscFile, color: '#9c4221', label: 'TOML' },
  xml: { icon: VscCode, color: '#e34c26', label: 'XML' },
  ini: { icon: VscSettings, color: '#6d6d6d', label: 'INI' },
  env: { icon: SiDotenv, color: '#ecd53f', label: 'Environment' },
  conf: { icon: VscSettings, color: '#6d6d6d', label: 'Config' },
  config: { icon: VscSettings, color: '#6d6d6d', label: 'Config' },
  log: { icon: VscListFlat, color: '#6d6d6d', label: 'Log' },
  license: { icon: VscShield, color: '#d1d5db', label: 'License' },

  // Markdown/Docs
  md: { icon: SiMarkdown, color: '#083fa1', label: 'Markdown' },
  mdx: { icon: VscMarkdown, color: '#083fa1', label: 'MDX' },
  txt: { icon: BsFileText, color: '#6d6d6d', label: 'Text' },
  rst: { icon: VscFile, color: '#6d6d6d', label: 'reStructuredText' },

  // Images
  apng: { icon: VscFileMedia, color: '#a074c4', label: 'Animated PNG' },
  avif: { icon: VscFileMedia, color: '#a074c4', label: 'AVIF Image' },
  bmp: { icon: VscFileMedia, color: '#a074c4', label: 'Bitmap Image' },
  png: { icon: VscFileMedia, color: '#a074c4', label: 'PNG Image' },
  jpg: { icon: VscFileMedia, color: '#a074c4', label: 'JPEG Image' },
  jpeg: { icon: VscFileMedia, color: '#a074c4', label: 'JPEG Image' },
  jfif: { icon: VscFileMedia, color: '#a074c4', label: 'JPEG Image' },
  gif: { icon: VscFileMedia, color: '#a074c4', label: 'GIF Image' },
  svg: { icon: VscFileMedia, color: '#ffb13b', label: 'SVG Image' },
  webp: { icon: VscFileMedia, color: '#a074c4', label: 'WebP Image' },
  ico: { icon: VscFileMedia, color: '#a074c4', label: 'Icon' },

  // Other languages
  vue: { icon: SiVuedotjs, color: '#42b883', label: 'Vue' },
  svelte: { icon: SiSvelte, color: '#ff3e00', label: 'Svelte' },
  dart: { icon: SiDart, color: '#0175c2', label: 'Dart' },
  scala: { icon: SiScala, color: '#dc322f', label: 'Scala' },
  clj: { icon: SiClojure, color: '#5881d8', label: 'Clojure' },
  ex: { icon: SiElixir, color: '#4e2a8e', label: 'Elixir' },
  exs: { icon: SiElixir, color: '#4e2a8e', label: 'Elixir Script' },
  erl: { icon: SiErlang, color: '#b83998', label: 'Erlang' },
  lua: { icon: SiLua, color: '#000080', label: 'Lua' },
  sql: { icon: FaDatabase, color: '#f55385', label: 'SQL' },
  graphql: { icon: SiGraphql, color: '#e10098', label: 'GraphQL' },
  gql: { icon: SiGraphql, color: '#e10098', label: 'GraphQL' },

  // Build/Config files
  dockerfile: { icon: SiDocker, color: '#2496ed', label: 'Dockerfile' },
  makefile: { icon: VscCode, color: '#6d6d6d', label: 'Makefile' },
  gradle: { icon: VscCode, color: '#02303a', label: 'Gradle' },
  groovy: { icon: SiApachegroovy, color: '#4298b8', label: 'Groovy' },
  cmake: { icon: SiCmake, color: '#064f8c', label: 'CMake' },

  // Java Archives
  jar: { icon: VscArchive, color: '#e42c2e', label: 'Java Archive' },
  war: { icon: VscArchive, color: '#e42c2e', label: 'Web Archive' },
  ear: { icon: VscArchive, color: '#e42c2e', label: 'Enterprise Archive' },

  // General Archives
  zip: { icon: VscFileZip, color: '#f1c40f', label: 'ZIP Archive' },
  tar: { icon: VscFileZip, color: '#f39c12', label: 'TAR Archive' },
  gz: { icon: VscFileZip, color: '#f39c12', label: 'GZip Archive' },
  tgz: { icon: VscFileZip, color: '#f39c12', label: 'TGZ Archive' },
  bz2: { icon: VscFileZip, color: '#f39c12', label: 'BZip2 Archive' },
  xz: { icon: VscFileZip, color: '#f39c12', label: 'XZ Archive' },
  rar: { icon: VscFileZip, color: '#8e44ad', label: 'RAR Archive' },
  '7z': { icon: VscFileZip, color: '#3498db', label: '7-Zip Archive' },

  // Database
  db: { icon: VscDatabase, color: '#336791', label: 'Database' },
  sqlite: { icon: SiSqlite, color: '#003b57', label: 'SQLite' },
  sqlite3: { icon: SiSqlite, color: '#003b57', label: 'SQLite' },
  mdb: { icon: VscDatabase, color: '#a4373a', label: 'Access Database' },
  accdb: { icon: VscDatabase, color: '#a4373a', label: 'Access Database' },

  // Executables/Binaries
  exe: { icon: VscFileBinary, color: '#3a96dd', label: 'Executable' },
  dll: { icon: VscFileBinary, color: '#3a96dd', label: 'Dynamic Library' },
  so: { icon: VscFileBinary, color: '#e95420', label: 'Shared Object' },
  dylib: { icon: VscFileBinary, color: '#999999', label: 'Dynamic Library' },
  bin: { icon: VscFileBinary, color: '#6d6d6d', label: 'Binary' },
  o: { icon: VscFileBinary, color: '#6d6d6d', label: 'Object File' },
  a: { icon: VscFileBinary, color: '#6d6d6d', label: 'Static Library' },
  lib: { icon: VscFileBinary, color: '#6d6d6d', label: 'Library' },
  class: { icon: VscFileBinary, color: '#b07219', label: 'Java Class' },
  pyc: { icon: VscFileBinary, color: '#3776ab', label: 'Python Compiled' },
  pyd: { icon: VscFileBinary, color: '#3776ab', label: 'Python Extension' },
  wasm: { icon: VscFileBinary, color: '#654ff0', label: 'WebAssembly' },

  // Fonts
  ttf: { icon: VscTextSize, color: '#ff69b4', label: 'TrueType Font' },
  otf: { icon: VscTextSize, color: '#ff69b4', label: 'OpenType Font' },
  woff: { icon: VscTextSize, color: '#ff69b4', label: 'Web Font' },
  woff2: { icon: VscTextSize, color: '#ff69b4', label: 'Web Font 2' },
  eot: { icon: VscTextSize, color: '#ff69b4', label: 'Embedded Font' },

  // Packages
  deb: { icon: VscPackage, color: '#a80030', label: 'Debian Package' },
  rpm: { icon: VscPackage, color: '#ee0000', label: 'RPM Package' },
  pkg: { icon: VscPackage, color: '#999999', label: 'Package' },
  dmg: { icon: VscPackage, color: '#999999', label: 'Disk Image' },
  msi: { icon: VscPackage, color: '#0078d4', label: 'Windows Installer' },
  apk: { icon: VscPackage, color: '#3ddc84', label: 'Android Package' },
  ipa: { icon: VscPackage, color: '#999999', label: 'iOS Package' },

  // Additional Languages
  pl: { icon: SiPerl, color: '#39457e', label: 'Perl' },
  pm: { icon: SiPerl, color: '#39457e', label: 'Perl Module' },
  hs: { icon: SiHaskell, color: '#5e5086', label: 'Haskell' },
  lhs: { icon: SiHaskell, color: '#5e5086', label: 'Literate Haskell' },
  fs: { icon: SiFsharp, color: '#378bba', label: 'F#' },
  fsx: { icon: SiFsharp, color: '#378bba', label: 'F# Script' },
  ml: { icon: SiOcaml, color: '#ec6813', label: 'OCaml' },
  mli: { icon: SiOcaml, color: '#ec6813', label: 'OCaml Interface' },
  nim: { icon: SiNim, color: '#ffe953', label: 'Nim' },
  zig: { icon: SiZig, color: '#f7a41d', label: 'Zig' },

  // Server configs
  nginx: { icon: SiNginx, color: '#009639', label: 'Nginx' },
  htaccess: { icon: SiApache, color: '#d22128', label: 'Apache Config' },

  // Audio/Video
  mp3: { icon: VscFileMedia, color: '#ff6b6b', label: 'MP3 Audio' },
  wav: { icon: VscFileMedia, color: '#ff6b6b', label: 'WAV Audio' },
  ogg: { icon: VscFileMedia, color: '#ff6b6b', label: 'OGG Audio' },
  flac: { icon: VscFileMedia, color: '#ff6b6b', label: 'FLAC Audio' },
  mp4: { icon: VscFileMedia, color: '#9b59b6', label: 'MP4 Video' },
  mkv: { icon: VscFileMedia, color: '#9b59b6', label: 'MKV Video' },
  avi: { icon: VscFileMedia, color: '#9b59b6', label: 'AVI Video' },
  mov: { icon: VscFileMedia, color: '#9b59b6', label: 'MOV Video' },
  webm: { icon: VscFileMedia, color: '#9b59b6', label: 'WebM Video' },

  // Documents
  pdf: { icon: BsFilePdf, color: '#e74c3c', label: 'PDF Document' },
  doc: { icon: BsFileWord, color: '#2b579a', label: 'Word Document' },
  docx: { icon: BsFileWord, color: '#2b579a', label: 'Word Document' },
  xls: { icon: VscFile, color: '#217346', label: 'Excel Spreadsheet' },
  xlsx: { icon: VscFile, color: '#217346', label: 'Excel Spreadsheet' },
  ppt: { icon: VscFile, color: '#d24726', label: 'PowerPoint' },
  pptx: { icon: VscFile, color: '#d24726', label: 'PowerPoint' },
  odt: { icon: VscFile, color: '#0066b3', label: 'OpenDocument Text' },
  ods: { icon: VscFile, color: '#0066b3', label: 'OpenDocument Spreadsheet' },
  odp: { icon: VscFile, color: '#0066b3', label: 'OpenDocument Presentation' },
};

/**
 * Map language IDs to extensions
 */
export const LANGUAGE_ID_TO_EXTENSION: Record<string, string> = {
  typescript: 'ts',
  javascript: 'js',
  javascriptreact: 'jsx',
  typescriptreact: 'tsx',
  python: 'py',
  rust: 'rs',
  ruby: 'rb',
  r: 'r',
  markdown: 'md',
  jsonc: 'json',
  shell: 'sh',
  bash: 'sh',
  sh: 'sh',
  zsh: 'sh',
  csharp: 'cs',
  dockerfile: 'dockerfile',
  powershell: 'ps1',
};

/**
 * Default fallback icon
 */
export const DEFAULT_FILE_ICON: FileIconConfig = { icon: VscFile, color: 'var(--vscode-foreground)', label: 'File' };
export const DEFAULT_CODE_ICON: FileIconConfig = { icon: VscCode, color: 'var(--vscode-foreground)', label: 'Code' };
