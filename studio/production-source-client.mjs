import http from 'node:http';

export function readProductionSource(route, params = new URLSearchParams(), signal) {
  const socketPath = process.env.STUDIO_SOURCE_SOCKET;
  if (!socketPath) return Promise.reject(Error('studio_source_not_configured'));
  return new Promise((resolve, reject) => {
    const request = http.get({socketPath, path:'/' + route + '?' + params, signal}, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(Error('studio_source_unavailable'));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) request.destroy(Error('studio_source_response_too_large'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (error) { reject(error); }
      });
    });
    request.setTimeout(125_000, () => request.destroy(Error('studio_source_timeout')));
    request.on('error', reject);
  });
}
