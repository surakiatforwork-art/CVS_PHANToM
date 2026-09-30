const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json(
        {
          ok: true,
          service: "cvs-phantom-api-dev",
          environment: "development"
        },
        { headers: jsonHeaders }
      );
    }

    return Response.json(
      { ok: false, error: "Not found" },
      { status: 404, headers: jsonHeaders }
    );
  }
};
