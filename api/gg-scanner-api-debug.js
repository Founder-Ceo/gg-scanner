export const config = { maxDuration: 10 };

module.exports = async function handler(req, res) {
  const key = process.env.ANTHROPIC_API_KEY;
  
  const result = {
    has_key: !!key,
    key_length: key ? key.length : 0,
    key_prefix: key ? key.substring(0, 14) + '...' : 'NOT FOUND',
    node_env: process.env.NODE_ENV || 'not set',
    timestamp: new Date().toISOString()
  };

  res.setHeader('Access-Control-Allow-Origin', '*'); res.status(200).json(result); return;
}
