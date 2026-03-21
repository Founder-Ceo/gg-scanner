export const config = { runtime: 'edge' };

export default async function handler(req) {
  const key = process.env.ANTHROPIC_API_KEY;
  
  const result = {
    has_key: !!key,
    key_length: key ? key.length : 0,
    key_prefix: key ? key.substring(0, 14) + '...' : 'NOT FOUND',
    node_env: process.env.NODE_ENV || 'not set',
    timestamp: new Date().toISOString()
  };

  return new Response(JSON.stringify(result, null, 2), {
    status: 200,
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
