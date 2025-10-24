require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const users = JSON.parse(fs.readFileSync("./User.json", "utf8")).users;
const products = JSON.parse(fs.readFileSync("./Product.json", "utf8")).products;
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const PRODUCTS_FILE = path.join(__dirname, './Product.json');


// Middleware: API Key

function checkApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    const err = new Error("API Key inválida o ausente");
    err.status = 401;
    return next(err);
  }
  next();
}


// Middleware: JWT

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


// RUTA: login

app.post('/auth/login', checkApiKey, (req, res, next) => {
  const { username, password } = req.body;
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

// RUTA: listado productos (paginación)

app.get('/productos', checkApiKey, (req, res, next) => {
  try {
    const pagina = parseInt(req.query.page) || 1;
    const limite = parseInt(req.query.limit) || 10;
    const start = (pagina - 1) * limite;
    const end = start + limite;
    const paginated = products.slice(start, end);

    return res.json({
      pagina,
      limite,
      total: products.length,
      data: paginated
    });
  } catch (err) {
    next(err);
  }
});
// RUTA: detalle producto
app.get('/products/:id', checkApiKey, (req, res, next) => {
  const productId = req.params.id;
  const product = products.find(p => p.id === productId);

  if (!product) {
    const err = new Error("Producto no encontrado");
    err.status = 404;
    return next(err);
  }

  res.json(product);
});
// Middleware global de errores
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    status,
    error: err.message || "Error interno del servidor"
  });
});

// helper para guardar cambios en JSON
function saveProducts() {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify({ products }, null, 2), "utf8");
}

// middleware de rol
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

// POST /products -> crear producto (editor o admin)
app.post('/products', jwtAuth, requireRole('editor', 'admin'), (req, res, next) => {
  const { name, sku, description, price, stock, category } = req.body;

  if (!name || !sku || !price || stock === undefined || !category) {
    const err = new Error("Faltan campos obligatorios");
    err.status = 422;
    return next(err);
  }
  if (price <= 0 || stock < 0) {
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
    price,
    stock,
    category,
    createdAt: now,
    updatedAt: now
  };

  products.push(newProduct);
  saveProducts();

  res.status(201).json(newProduct);
});

// PUT /products/:id -> actualizar producto (editor o admin)
app.put('/products/:id', jwtAuth, requireRole('editor', 'admin'), (req, res, next) => {
  const product = products.find(p => p.id === req.params.id);
  if (!product) {
    const err = new Error("Producto no encontrado");
    err.status = 404;
    return next(err);
  }

  const { name, sku, description, price, stock, category } = req.body;

  if (sku && products.some(p => p.sku === sku && p.id !== req.params.id)) {
    const err = new Error("SKU ya existe en otro producto");
    err.status = 409;
    return next(err);
  }

  if (price !== undefined && price <= 0) {
    const err = new Error("Precio inválido");
    err.status = 422;
    return next(err);
  }

  if (stock !== undefined && stock < 0) {
    const err = new Error("Stock inválido");
    err.status = 422;
    return next(err);
  }

  Object.assign(product, { name, sku, description, price, stock, category });
  product.updatedAt = new Date().toISOString();

  saveProducts();
  res.json(product);
});

// DELETE /products/:id -> eliminar producto (solo admin)
app.delete('/products/:id', jwtAuth, requireRole('admin'), (req, res, next) => {
  const index = products.findIndex(p => p.id === req.params.id);
  if (index === -1) {
    const err = new Error("Producto no encontrado");
    err.status = 404;
    return next(err);
  }

  products.splice(index, 1);
  saveProducts();

  res.status(204).end();
});



app.listen(PORT, () => console.log(`Servidor escuchando en http://localhost:${PORT}`));
