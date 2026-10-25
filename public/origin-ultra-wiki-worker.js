self.onmessage = async (event) => {
  const { id, query } = event.data || {};
  try {
    if (typeof id !== 'string' || typeof query !== 'string' || !query.trim()) {
      throw new Error('Invalid Wikipedia search request');
    }
    const url = new URL('https://ja.wikipedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: '5',
      srprop: 'snippet',
      format: 'json',
      origin: '*'
    }).toString();
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error('Wikipedia API HTTP ' + response.status);
    const data = await response.json();
    self.postMessage({
      id,
      ok: true,
      items: (data.query?.search || []).map(item => ({
        title: item.title,
        snippet: String(item.snippet || '').replace(/<[^>]*>/g, ''),
        pageid: item.pageid
      }))
    });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
};
setInterval(() => self.postMessage({ type: 'heartbeat', at: Date.now() }), 5000);
