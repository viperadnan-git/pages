<div align="center">

# Pages

**A control room for small, single-purpose tools — built and hosted in the open.**

A collection of utility tools and browser-based applications. Everything runs
client-side: no accounts, no build step, no tracking.

[**Open Pages →**](https://viperadnan-git.github.io/pages/)

</div>

---

## What's inside

The [landing page](https://viperadnan-git.github.io/pages/) is the live index —
it reads the repo tree from the GitHub API and renders a card per folder,
pulling each page's title, description, and preview at runtime.

## How it works

Each tool lives in its own folder with an `index.html`. GitHub Pages serves the
whole repo; the root `index.html` discovers every page directory and builds the
grid. Previews fall back gracefully: **OG image → screenshot API → placeholder**.

## Add a page

```
mkdir my-tool
# drop an index.html inside — that's it
```

Push to `main`. The landing page picks it up on the next load; no config, no
list to update.

## Run locally

```
python3 -m http.server 8000   # then open http://localhost:8000
```

## License

[MIT](LICENSE) © [viperadnan](https://github.com/viperadnan-git)
