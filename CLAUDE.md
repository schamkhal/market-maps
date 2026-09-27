# Claude alternative-design workspace

This directory is an isolated copy of the Personal AI Agents market-map project.
Changes here must not modify the original project in the sibling
`market-maps/` directory.

## Objective

First review the current interface and give concise visual-design suggestions.
Then implement a coherent alternative visual direction in this copy so it can
be compared with the original.

## Constraints

- Preserve the dataset, company facts, calculations, filters, URLs, and
  application behavior.
- Do not remove attribution, sourcing, confidence labels, caveats, or
  accessibility features.
- Keep the site responsive and usable on desktop and mobile.
- Prefer changes in `templates/map.css`; adjust rendering code only when the
  visual treatment requires it.
- Run `npm run validate`, `npm test`, and `npm run build:relative` before
  considering the alternative complete.
- The comparison preview runs on `http://127.0.0.1:5174/` with
  `PORT=5174 npm run preview`.
