export default {
    async fetch(request, env, ctx) {
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Expose-Headers": "*"
        };

        // Handle CORS preflight requests
        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: corsHeaders
            });
        }

        const url = new URL(request.url);

        // The target URL is the path after the worker's domain
        // e.g. https://worker.dev/https://github.com/...
        const targetUrl = url.pathname.slice(1) + url.search;

        if (!targetUrl || !targetUrl.startsWith('http')) {
            return new Response("Invalid URL. Usage: https://worker-url/https://target-url", {
                status: 400,
                headers: corsHeaders
            });
        }

        try {
            // Create a new request to the target
            const targetRequest = new Request(targetUrl, {
                method: request.method,
                headers: request.headers,
                body: request.body,
                redirect: "follow"
            });

            // Fetch from target
            const response = await fetch(targetRequest);

            // Create a new response with the target's body and status
            // but with our CORS headers
            const newResponse = new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: new Headers(response.headers)
            });

            // Apply CORS headers to the response
            Object.keys(corsHeaders).forEach(key => {
                newResponse.headers.set(key, corsHeaders[key]);
            });

            // Ensure we expose all headers from the original response
            // This is important for git smart protocol which uses specific headers like Content-Type
            newResponse.headers.set("Access-Control-Expose-Headers", "*");

            return newResponse;

        } catch (e) {
            return new Response(`Proxy Error: ${e.message}`, {
                status: 500,
                headers: corsHeaders
            });
        }
    }
};
