// Colour themes. A theme sets the island body colour, its outline (normal and
// while hovered) and the default accent colour (bars, dots, today in the
// calendar, toggles...). The user's own accent colour, if set, overrides the
// theme's accent. Everything else (white-on-dark text, translucent cards)
// works on any of these dark bodies.

export const THEMES = {
    ink: {
        label: 'Ink',
        bg: '#000000',
        edge: 'rgba(255, 255, 255, 0.08)',
        edgeHover: 'rgba(255, 255, 255, 0.16)',
        accent: '#5ee6b5',
    },
    midnight: {
        label: 'Midnight',
        bg: '#070b1c',
        edge: 'rgba(122, 162, 255, 0.24)',
        edgeHover: 'rgba(122, 162, 255, 0.46)',
        accent: '#7aa2ff',
    },
    sunset: {
        label: 'Sunset',
        bg: '#160a0c',
        edge: 'rgba(255, 138, 92, 0.26)',
        edgeHover: 'rgba(255, 138, 92, 0.50)',
        accent: '#ff8a5c',
    },
    forest: {
        label: 'Forest',
        bg: '#07120c',
        edge: 'rgba(110, 224, 154, 0.24)',
        edgeHover: 'rgba(110, 224, 154, 0.46)',
        accent: '#6ee09a',
    },
    rose: {
        label: 'Rose',
        bg: '#150a12',
        edge: 'rgba(255, 127, 176, 0.26)',
        edgeHover: 'rgba(255, 127, 176, 0.50)',
        accent: '#ff7fb0',
    },
};

export const DEFAULT_THEME = 'ink';

/** Theme object for a name; unknown names fall back to the default. */
export function themeFor(name) {
    return THEMES[name] ?? THEMES[DEFAULT_THEME];
}
