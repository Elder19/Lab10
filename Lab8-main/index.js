require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/* =========================================================
   CARGA DE USUARIOS (igual que antes)
   ========================================================= */
const users = JSON.parse(fs.readFileSync("./User.json", "utf8")).users;

/* =========================================================
   DETECCIÓN Y CARGA DE PRODUCTS (tolera 2 archivos y 2 formas)
   - Archivos buscados: ./Product.json o ./products.json
   - Formas soportadas:
       a) { "products": [ ... ] }
       b) [ ... ]  (arreglo directo)
   ========================================================= */
function findProductsFile() {
  const candidates = [
    path.join(__dirname, 'Product.json'),
    path.join(__dirname, 'products.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // Si no existe, por defecto crea Product.json con wrapper
  const def = candidates[0];
  fs.writeFileSync(def, JSON.stringify({ products: [] }, null, 2), 'utf8');
  return def;
}

const PRODUCTS_FILE = findProductsFile();

function loadProductsFromDisk() {
  const raw = fs.readFileSync(PRODUCTS_FILE, 'utf8').trim();
  if (!raw) return { products: [], wrapper: 'object' };

  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    // Forma arreglo directo
    return { products: parsed, wrapper: 'array' };
  }
  if (parsed && Array.isArray(parsed.products)) {
    // Forma con wrapper { products: [...] }
    return { products: parsed.products, wrapper: 'object' };
  }
  // Si el contenido es inválido, normaliza
  return { products: [], wrapper: 'object' };
}

let { products, wrapper } = loadProductsFromDisk();

function saveProductsToDisk() {
  if (wrapper === 'array') {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf8');
  } else {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify({ products }, null, 2), 'utf8');
  }
}

/* =========================================================
   M IDDLEWARES
   ========================================================= */
function checkApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    const err = new Error("API Key inválida o ausente");
    err.status = 401;
    return next(err);
  }
  next();
}

function jwtAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    const err = new Error("Falta Authorization Bearer token");
    err.status = 401;
    return next(err);
  }
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "mi-secreto");
    req.user = payload;
    next();
  } catch (err) {
    err.status = 401;
    err.message = "Token inválido o expirado";
    next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      const err = new Error("Permiso denegado");
      err.status = 403;
      return next(err);
    }
    next();
  };
}

/* =========================================================
   NEGOCIACIÓN DE CONTENIDO
   - Soporta application/json (default) y application/xml
   ========================================================= */
function pickFormat(req) {
  const accept = (req.headers['accept'] || '').toLowerCase();
  if (accept.includes('application/xml') || accept.includes('text/xml')) return 'xml';
  return 'json';
}

function toXmlValue(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function productToXML(p) {
  return [
    '  <product>',
    `    <id>${toXmlValue(p.id)}</id>`,
    `    <name>${toXmlValue(p.name)}</name>`,
    `    <sku>${toXmlValue(p.sku)}</sku>`,
    `    <description>${toXmlValue(p.description)}</description>`,
    `    <price>${toXmlValue(p.price)}</price>`,
    `    <stock>${toXmlValue(p.stock)}</stock>`,
    `    <category>${toXmlValue(p.category)}</category>`,
    `    <createdAt>${toXmlValue(p.createdAt)}</createdAt>`,
    `    <updatedAt>${toXmlValue(p.updatedAt)}</updatedAt>`,
    '  </product>'
  ].join('\n');
}

function listToXML({ page, limit, total, data }) {
  const items = data.map(productToXML).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<productsResponse>\n` +
         `  <page>${page}</page>\n` +
         `  <limit>${limit}</limit>\n` +
         `  <total>${total}</total>\n` +
         `  <products>\n${items}\n  </products>\n` +
         `</productsResponse>`;
}

/* =========================================================
   AUTH: LOGIN (igual que tenías)
   ========================================================= */
app.post('/auth/login', checkApiKey, (req, res, next) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    const err = new Error("username y password requeridos");
    err.status = 400;
    return next(err);
  }
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) {
    const err = new Error("Credenciales inválidas");
    err.status = 401;
    return next(err);
  }
  const payload = { id: user.id, username: user.username, role: user.role };
  const token = jwt.sign(payload, process.env.JWT_SECRET || "mi-secreto", { expiresIn: "1h" });
  res.json({ status: "success", token });
});

/* =========================================================
   ENDPOINTS LAB 10 (GET) – solo API KEY, con negociación
   ========================================================= */

// Compat: mantener también /productos para no romper nada viejo
app.get(['/products', '/productos'], checkApiKey, (req, res, next) => {
  try {
    // Recargar desde disco por si otro proceso o edición manual cambió el archivo
    ({ products, wrapper } = loadProductsFromDisk());

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit) || 10, 1);

    const total = products.length;
    const start = (page - 1) * limit;
    const end = start + limit;
    const data = products.slice(start, end);

    const fmt = pickFormat(req);
    if (fmt === 'xml') {
      res.type('application/xml').send(listToXML({ page, limit, total, data }));
    } else {
      res.json({ page, limit, total, data });
    }
  } catch (err) {
    next(err);
  }
});

app.get('/products/:id', checkApiKey, (req, res, next) => {
  try {
    ({ products, wrapper } = loadProductsFromDisk());
    const product = products.find(p => String(p.id) === String(req.params.id));
    if (!product) {
      const err = new Error("Producto no encontrado");
      err.status = 404;
      return next(err);
    }

    const fmt = pickFormat(req);
    if (fmt === 'xml') {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<productDetail>\n${productToXML(product)}\n</productDetail>`;
      res.type('application/xml').send(xml);
    } else {
      res.json(product);
    }
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   CRUD protegido (como ya lo tenías)
   ========================================================= */
app.post('/products', jwtAuth, requireRole('editor', 'admin'), (req, res, next) => {
  const { name, sku, description, price, stock, category } = req.body || {};

  if (!name || !sku || price == null || stock == null || !category) {
    const err = new Error("Faltan campos obligatorios");
    err.status = 422;
    return next(err);
  }
  if (Number(price) <= 0 || Number(stock) < 0) {
    const err = new Error("Precio o stock inválidos");
    err.status = 422;
    return next(err);
  }
  if (products.find(p => p.sku === sku)) {
    const err = new Error("SKU ya existe");
    err.status = 409;
    return next(err);
  }

  const now = new Date().toISOString();
  const newProduct = {
    id: uuidv4(),
    name,
    sku,
    description: description || "",
    price: Number(price),
    stock: Number(stock),
    category,
    createdAt: now,
    updatedAt: now
  };

  products.push(newProduct);
  saveProductsToDisk();
  res.status(201).json(newProduct);
});

app.put('/products/:id', jwtAuth, requireRole('editor', 'admin'), (req, res, next) => {
  const product = products.find(p => String(p.id) === String(req.params.id));
  if (!product) {
    const err = new Error("Producto no encontrado");
    err.status = 404;
    return next(err);
  }

  const { name, sku, description, price, stock, category } = req.body || {};

  if (sku && products.some(p => p.sku === sku && String(p.id) !== String(req.params.id))) {
    const err = new Error("SKU ya existe en otro producto");
    err.status = 409;
    return next(err);
  }
  if (price !== undefined && Number(price) <= 0) {
    const err = new Error("Precio inválido");
    err.status = 422;
    return next(err);
  }
  if (stock !== undefined && Number(stock) < 0) {
    const err = new Error("Stock inválido");
    err.status = 422;
    return next(err);
  }

  Object.assign(product, {
    ...(name !== undefined ? { name } : {}),
    ...(sku !== undefined ? { sku } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(price !== undefined ? { price: Number(price) } : {}),
    ...(stock !== undefined ? { stock: Number(stock) } : {}),
    ...(category !== undefined ? { category } : {}),
    updatedAt: new Date().toISOString()
  });

  saveProductsToDisk();
  res.json(product);
});

app.delete('/products/:id', jwtAuth, requireRole('admin'), (req, res, next) => {
  const idx = products.findIndex(p => String(p.id) === String(req.params.id));
  if (idx === -1) {
    const err = new Error("Producto no encontrado");
    err.status = 404;
    return next(err);
  }
  products.splice(idx, 1);
  saveProductsToDisk();
  res.status(204).end();
});

/* =========================================================
   MANEJADOR GLOBAL DE ERRORES
   - Devuelve JSON por defecto; si el cliente pidió XML,
     responde en XML.
   ========================================================= */
app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || "Error interno del servidor";

  const fmt = pickFormat(req);
  if (fmt === 'xml') {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
                `<error>\n  <status>${status}</status>\n  <message>${toXmlValue(message)}</message>\n` +
                `  <path>${toXmlValue(req.originalUrl)}</path>\n  <timestamp>${new Date().toISOString()}</timestamp>\n</error>`;
    res.status(status).type('application/xml').send(xml);
    return;
  }

  res.status(status).json({
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    status,
    error: message
  });
});

app.listen(PORT, () => console.log(`Servidor escuchando en http://localhost:${PORT}`));
