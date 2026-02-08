# Deploying the CORS Proxy

This directory contains a Cloudflare Worker that acts as a CORS proxy for `isomorphic-git`.

## Prerequisites

- Node.js installed
- A Cloudflare account (Free tier is fine)

## Deployment Steps

1.  **Install Dependencies** (if needed, though `npx` works without checking node_modules):
    ```bash
    npm install
    ```

2.  **Login to Cloudflare**:
    ```bash
    npx wrangler login
    ```
    This will open a browser window to authenticate.

3.  **Deploy the Worker**:
    ```bash
    npx wrangler deploy
    ```

4.  **Get the URL**:
    After deployment, Wrangler will print a URL ending in `.workers.dev`.
    Example: `https://isomorphic-git-cors-proxy.your-subdomain.workers.dev`

## Update the Web App

1.  Open `../app.js`.
2.  Locate `const CORS_PROXIES` (around line 38).
3.  Add your new Worker URL to the top of the list:

    ```javascript
    const CORS_PROXIES = [
        'https://isomorphic-git-cors-proxy.your-subdomain.workers.dev/', // <--- Your new URL
        'https://cors.isomorphic-git.org',
        'https://corsproxy.io/?url=',
    ];
    ```
4.  **Don't forget the trailing slash** (or check how your URL works, but usually it helps to keep format consistent).

## Testing

Run the web app and check the console or the connection status indicator. It should say "Online (proxy connected)" and default to your new, fast, private proxy.
