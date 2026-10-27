// @ts-check
import {defineConfig} from 'astro/config'
import starlight from '@astrojs/starlight'
import {remarkCallouts} from './src/plugins/remark-callouts.ts'

const expressiveConfig = {
    themes: /** @type {const} */ (['github-dark', 'github-light']),
    useDarkModeMediaQuery: false,
    themeCssSelector: (/** @type {any} */ theme) => `[data-theme='${theme.type}'], :root.${theme.type}`,
    defaultProps: {
        wrap: false,
    },
    styleOverrides: {
        borderRadius: '0.375rem',
        borderWidth: '1px',
        borderColor: 'var(--code-border, var(--border))',
        codeBackground: 'var(--code-panel-bg)',
        codeForeground: 'var(--code-foreground)',
        codeFontFamily: 'var(--sl-font-mono, monospace)',
        codeFontSize: '0.8125rem',
        codeLineHeight: '1.7',
        codePaddingBlock: '1.125rem',
        codePaddingInline: '1.5rem',
        frames: {
            editorBackground: 'var(--code-panel-bg)',
            editorTabBarBackground: 'var(--code-panel-header)',
            editorTabBarBorderBottomColor: 'var(--code-border, var(--border))',
            editorActiveTabBackground: 'var(--code-panel-bg)',
            editorActiveTabForeground: 'var(--code-foreground)',
            editorActiveTabBorderColor: 'var(--sl-color-accent)',
            editorActiveTabIndicatorTopColor: 'var(--sl-color-accent)',
            editorActiveTabIndicatorHeight: '2px',
            editorTabBorderRadius: '0.25rem',
            terminalTitlebarBackground: 'var(--code-panel-header)',
            terminalTitlebarForeground: 'var(--sl-color-gray-3)',
            terminalTitlebarDotsForeground: 'transparent',
            terminalTitlebarDotsOpacity: '0',
            terminalTitlebarBorderBottomColor: 'var(--code-border, var(--border))',
            terminalBackground: 'var(--code-panel-bg)',
            frameBoxShadowCssValue: 'none',
            inlineButtonForeground: 'var(--sl-color-gray-3)',
            inlineButtonBackground: 'transparent',
            inlineButtonBackgroundIdleOpacity: '0',
            inlineButtonBackgroundHoverOrFocusOpacity: '0.15',
            inlineButtonBackgroundActiveOpacity: '0.25',
            inlineButtonBorder: 'var(--code-border, var(--border))',
            inlineButtonBorderOpacity: '0.3',
            tooltipSuccessBackground: '#238636',
            tooltipSuccessForeground: '#ffffff',
        },
    },
}

export default defineConfig({
    site: 'https://tarmac.rushingclouds.com',
    output: 'static',
    integrations: [
        starlight({
            title: 'Tarmac CLI',
            description: 'Documentation for tarmac-cli, a Python CLI for managing multi-account AWS Organizations from YAML.',
            favicon: '/favicon.svg',
            expressiveCode: /** @type {any} */ (expressiveConfig),
            components: {
                Header: './src/components/starlight/Header.astro',
            },
            customCss: [
                './src/styles/starlight-custom.css',
            ],
            social: [
                { icon: 'github', label: 'GitHub', href: 'https://github.com/nickdchristian/tarmac-cli' },
            ],
            sidebar: [
                {
                    label: 'Tarmac CLI',
                    collapsed: false,
                    items: [
                        { label: 'Overview', slug: '' },
                        { label: 'Quickstart & CI/CD', slug: 'quickstart' },
                        { label: 'Configuration', slug: 'configuration' },
                        { label: 'Commands & Teardown', slug: 'commands' },
                    ],
                },
            ],
        }),
    ],
    markdown: {
        remarkPlugins: [remarkCallouts],
    },
})
