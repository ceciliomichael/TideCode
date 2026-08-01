# TideCode installer font

The installer bundles the Latin subset of Google Sans Flex so its native Windows controls can use the same typeface as TideCode without depending on an internet connection or a font already installed on the user's computer.

The font is distributed under the SIL Open Font License 1.1. The license text is included beside the font in `OFL-1.1.txt`.

The web application uses the complete self-hosted font package from `@fontsource-variable/google-sans-flex`; the installer uses the smaller Latin TrueType build because NSIS can load TrueType fonts for the duration of the setup process.
