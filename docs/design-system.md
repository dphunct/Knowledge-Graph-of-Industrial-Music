# Interface design system

The graph uses a small, local CSS system rather than a framework or component
dependency. This keeps the static site portable, preserves its dark editorial
character, and adds no JavaScript or package weight.

## Tokens

`src/style.css` defines the shared color, spacing, radius, focus, and surface
tokens. New interface work should use these tokens instead of adding literal
values unless a graph data color requires a deliberate exception.

## Primitives

- `ui-surface` — bordered dark panel.
- `ui-field` — form field treatment (native inputs and selects receive it too).
- `ui-button` — common action treatment.
- `ui-button--primary` — prominent, committing action.
- `ui-button--quiet` — secondary action.
- `ui-button--icon` — compact icon control.
- `ui-help` — compact tooltip trigger.

Semantic regions also inherit the same field and action treatments while older
markup is gradually normalized. Native controls and the native dialog remain
the accessibility foundation; components do not replace their behavior.

## Interaction rules

All focusable controls have a visible warm focus ring. Hover and pressed states
use the same border, surface, and accent rules. Responsive tiers preserve the
graph-first layout from phone through extra-large displays.
