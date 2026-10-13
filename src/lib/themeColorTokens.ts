import type { ResolvedTheme } from './theme'

export type ThemeColorTokenName =
  | '--color-background'
  | '--color-foreground'
  | '--color-muted-foreground'
  | '--color-subtle-foreground'
  | '--color-surface'
  | '--color-surface-muted'
  | '--color-surface-raised'
  | '--color-surface-hover'
  | '--color-sidebar'
  | '--color-sidebar-muted'
  | '--color-border'
  | '--color-border-muted'
  | '--color-brand'
  | '--color-brand-soft'
  | '--color-brand-soft-foreground'
  | '--color-accent-hover'
  | '--color-action'
  | '--color-action-hover'
  | '--color-action-foreground'
  | '--color-switch-off-track'
  | '--color-switch-off-thumb'
  | '--color-success-foreground'
  | '--color-warning-foreground'
  | '--color-danger-foreground'
  | '--color-info-foreground'

const FALLBACKS: Record<ResolvedTheme, Record<ThemeColorTokenName, string>> = {
  light: {
    '--color-background': '#f6f7f6',
    '--color-foreground': '#202221',
    '--color-muted-foreground': '#666b68',
    '--color-subtle-foreground': '#8a908c',
    '--color-surface': '#ffffff',
    '--color-surface-muted': '#f0f2f0',
    '--color-surface-raised': '#ffffff',
    '--color-surface-hover': '#e9ecea',
    '--color-sidebar': '#eef1ef',
    '--color-sidebar-muted': '#e4e8e5',
    '--color-border': '#d4d9d5',
    '--color-border-muted': '#e1e5e2',
    '--color-brand': '#315f59',
    '--color-brand-soft': '#d9e9e6',
    '--color-brand-soft-foreground': '#315f59',
    '--color-accent-hover': '#cfe2de',
    '--color-action': '#d9e9e6',
    '--color-action-hover': '#cfe2de',
    '--color-action-foreground': '#315f59',
    '--color-switch-off-track': '#8b918d',
    '--color-switch-off-thumb': '#ffffff',
    '--color-success-foreground': '#24783f',
    '--color-warning-foreground': '#8a5a05',
    '--color-danger-foreground': '#b4232d',
    '--color-info-foreground': '#1d5f91',
  },
  dark: {
    '--color-background': '#0f0f10',
    '--color-foreground': '#e9e9ea',
    '--color-muted-foreground': '#b5b5b8',
    '--color-subtle-foreground': '#8f8f95',
    '--color-surface': '#171718',
    '--color-surface-muted': '#202022',
    '--color-surface-raised': '#242426',
    '--color-surface-hover': '#2a2a2d',
    '--color-sidebar': '#131314',
    '--color-sidebar-muted': '#1c1c1e',
    '--color-border': '#38383d',
    '--color-border-muted': '#2c2c30',
    '--color-brand': '#87aea4',
    '--color-brand-soft': '#223630',
    '--color-brand-soft-foreground': '#bfd7d1',
    '--color-accent-hover': '#2a443d',
    '--color-action': '#223630',
    '--color-action-hover': '#2a443d',
    '--color-action-foreground': '#bfd7d1',
    '--color-switch-off-track': '#68686e',
    '--color-switch-off-thumb': '#ffffff',
    '--color-success-foreground': '#8bd6a1',
    '--color-warning-foreground': '#e8c56a',
    '--color-danger-foreground': '#f48771',
    '--color-info-foreground': '#84bfea',
  },
}

export function readThemeColor(token: ThemeColorTokenName, theme: ResolvedTheme): string {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const value = window.getComputedStyle(document.documentElement).getPropertyValue(token).trim()
    if (value.length > 0) return value
  }
  return FALLBACKS[theme][token]
}

export function getThemeColorFallback(token: ThemeColorTokenName, theme: ResolvedTheme): string {
  return FALLBACKS[theme][token]
}
