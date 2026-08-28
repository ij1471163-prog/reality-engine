export default function handler(req, res) {
  const key = process.env.GEMINIKEY || "";
  res.status(200).json({ key: key, found: key.length > 0 });
}
