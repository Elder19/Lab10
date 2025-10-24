import { useEffect, useMemo, useState } from "react";
import "./styles.css";

/* =============================
   CONFIG FRONT
   ============================= */
const API_KEY = "mi-api-key-secreta"; 
const BASE = "";

/* =============================
   HELPERS embebidos (fetch/XML/errores)
   ============================= */
function pickHeaders(format) {
  const h = new Headers();
  h.set("x-api-key", API_KEY);
  h.set("Accept", format === "xml" ? "application/xml" : "application/json");
  return h;
}
function prettyJSON(txt) {
  try { return JSON.stringify(JSON.parse(txt), null, 2); } catch { return txt; }
}
function readErrorMessage(raw, ctype) {
  try {
    if (ctype?.includes("xml")) {
      const dom = new DOMParser().parseFromString(raw, "application/xml");
      return dom.querySelector("error > message")?.textContent || "Error";
    }
    if (ctype?.includes("json")) {
      const j = JSON.parse(raw);
      return j.error || j.message || "Error";
    }
  } catch {}
  return "Error en la solicitud";
}
function parseProductsListXML(txt) {
  const dom = new DOMParser().parseFromString(txt, "application/xml");
  if (dom.querySelector("parsererror")) throw new Error("XML inválido");

  const page  = Number(dom.querySelector("productsResponse > page")?.textContent ?? 1);
  const limit = Number(dom.querySelector("productsResponse > limit")?.textContent ?? 10);
  const total = Number(dom.querySelector("productsResponse > total")?.textContent ?? 0);

  const products = Array.from(dom.querySelectorAll("productsResponse > products > product")).map(n => ({
    id: n.querySelector("id")?.textContent ?? "",
    name: n.querySelector("name")?.textContent ?? "",
    sku: n.querySelector("sku")?.textContent ?? "",
    description: n.querySelector("description")?.textContent ?? "",
    price: Number(n.querySelector("price")?.textContent ?? 0),
    stock: Number(n.querySelector("stock")?.textContent ?? 0),
    category: n.querySelector("category")?.textContent ?? "",
    createdAt: n.querySelector("createdAt")?.textContent ?? "",
    updatedAt: n.querySelector("updatedAt")?.textContent ?? "",
  }));

  return { page, limit, total, data: products };
}
function parseProductDetailXML(txt) {
  const dom = new DOMParser().parseFromString(txt, "application/xml");
  if (dom.querySelector("parsererror")) throw new Error("XML inválido");
  const node = dom.querySelector("productDetail > product") || dom.querySelector("product");
  return {
    id: node?.querySelector("id")?.textContent ?? "",
    name: node?.querySelector("name")?.textContent ?? "",
    sku: node?.querySelector("sku")?.textContent ?? "",
    description: node?.querySelector("description")?.textContent ?? "",
    price: Number(node?.querySelector("price")?.textContent ?? 0),
    stock: Number(node?.querySelector("stock")?.textContent ?? 0),
    category: node?.querySelector("category")?.textContent ?? "",
    createdAt: node?.querySelector("createdAt")?.textContent ?? "",
    updatedAt: node?.querySelector("updatedAt")?.textContent ?? "",
  };
}
async function fetchProducts({ page, limit, format }) {
  const url = `${BASE}/products?page=${page}&limit=${limit}`;
  const headers = pickHeaders(format);
  const res = await fetch(url, { headers });
  const raw = await res.text();
  if (!res.ok) throw new Error(readErrorMessage(raw, res.headers.get("content-type")));
  if (headers.get("Accept").includes("xml")) {
    return { parsed: parseProductsListXML(raw), raw }; // XML
  } else {
    return { parsed: JSON.parse(raw), raw: prettyJSON(raw) }; // JSON
  }
}
async function fetchProductDetail(id, format) {
  const url = `${BASE}/products/${encodeURIComponent(id)}`;
  const headers = pickHeaders(format);
  const res = await fetch(url, { headers });
  const raw = await res.text();
  if (!res.ok) throw new Error(readErrorMessage(raw, res.headers.get("content-type")));
  if (headers.get("Accept").includes("xml")) {
    return { parsed: parseProductDetailXML(raw), raw };
  } else {
    return { parsed: JSON.parse(raw), raw: prettyJSON(raw) };
  }
}


function sortItems(items, sort) {
  const [field, dir] = sort.split(":");
  const sgn = dir === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    const va = a?.[field] ?? "";
    const vb = b?.[field] ?? "";
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * sgn;
    return String(va).localeCompare(String(vb)) * sgn;
  });
}
function SkeletonCard() {
  return (
    <div className="card skeleton">
      <div className="sk-line sk-title"></div>
      <div className="sk-line"></div>
    </div>
  );
}
function ProductCard({ p, onClick }) {
  return (
    <button className="card" onClick={onClick} title="Ver detalle">
      <div className="title">{p.name}</div>
      <div className="sku">{p.sku}</div>
    </button>
  );
}
function Modal({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>×</button>
        {children}
      </div>
    </div>
  );
}

/* =============================
   APP
   ============================= */
export default function App() {

  const [format, setFormat] = useState("json"); // json | xml
  const [limit, setLimit] = useState(12);
  const [sort, setSort]   = useState("name:asc");

  // Paginación
  const [page, setPage]   = useState(1);

  // Listado
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [items, setItems]     = useState([]);
  const [total, setTotal]     = useState(0);
  const [rawList, setRawList] = useState("");

  // Detalle
  const [openDetail, setOpenDetail] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError]     = useState("");
  const [detail, setDetail] = useState(null);
  const [detailRaw, setDetailRaw] = useState("");
  const [showRaw, setShowRaw] = useState(false); // toggle visible solo en el modal

  // Cargar listado cuando cambian page/limit/format
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError("");
      try {
        const { parsed, raw } = await fetchProducts({ page, limit, format });
        if (cancelled) return;
        setItems(parsed.data);
        setTotal(parsed.total);
        setRawList(raw);
      } catch (e) {
        if (cancelled) return;
        setError(e.message || "Error cargando productos");
        setItems([]); setTotal(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [page, limit, format]);


  const sortedItems = useMemo(() => sortItems(items, sort), [items, sort]);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Eventos
  function onChangeFormat(e) { setFormat(e.target.value); setPage(1); }
  function onChangeLimit(e)  { setLimit(Number(e.target.value)); setPage(1); }
  function onChangeSort(e)   { setSort(e.target.value); }
async function openProduct(p) {
  setOpenDetail(true);
 
  setDetailLoading(true);
  setDetailError(""); setDetail(null); setDetailRaw("");
  try {
    const { parsed, raw } = await fetchProductDetail(p.id, format);
    setDetail(parsed); setDetailRaw(raw);
  } catch (e) {
    setDetailError(e.message || "Error cargando detalle");
  } finally {
    setDetailLoading(false);
  }
}

  function retry() { setPage(p => p); }

  return (
    <div className="container">
      <header className="controls">
        <div className="group">
          <label>Formato</label>
          <select value={format} onChange={onChangeFormat}>
            <option value="json">JSON</option>
            <option value="xml">XML</option>
          </select>
        </div>
        <div className="group">
          <label>Page size</label>
          <select value={limit} onChange={onChangeLimit}>
            <option value={6}>6</option>
            <option value={12}>12</option>
            <option value={24}>24</option>
            <option value={48}>48</option>
          </select>
        </div>
        <div className="group">
          <label>Orden</label>
          <select value={sort} onChange={onChangeSort}>
            <option value="name:asc">name:asc</option>
            <option value="name:desc">name:desc</option>
            <option value="price:asc">price:asc</option>
            <option value="price:desc">price:desc</option>
          </select>
        </div>

        <div className="spacer" />
       
        <div className="raw-toggle">
          <label>Raw</label>
          <input
            type="checkbox"
            checked={showRaw}
            onChange={(e) => setShowRaw(e.target.checked)}
            title="Ver respuesta cruda en el modal"
          />
        </div>
      </header>


      {loading && (
        <div className="grid">
          {Array.from({ length: Math.min(limit, 12) }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}
      {!loading && error && (
        <div className="error">
          <div>⚠️ {error}</div>
          <button onClick={retry}>Reintentar</button>
        </div>
      )}
      {!loading && !error && sortedItems.length === 0 && (
        <div className="empty">No hay productos para mostrar.</div>
      )}
      {!loading && !error && sortedItems.length > 0 && (
        <>
          <div className="grid">
            {sortedItems.map(p => (
              <ProductCard key={p.id} p={p} onClick={() => openProduct(p)} />
            ))}
          </div>
          <footer className="pager">
            <button disabled={page<=1} onClick={() => setPage(p => p-1)}>Anterior</button>
            <span>page {page} / {totalPages}</span>
            <button disabled={page>=totalPages} onClick={() => setPage(p => p+1)}>Siguiente</button>
          </footer>
        </>
      )}

      <Modal open={openDetail} onClose={() => setOpenDetail(false)}>
        {detailLoading && <div className="loading">Cargando detalle…</div>}
        {!detailLoading && detailError && <div className="error small"> {detailError}</div>}
        {!detailLoading && !detailError && detail && (
          <>
            {!showRaw && (
              <div className="detail">
                <h2>{detail.name}</h2>
                <dl>
                  <dt>SKU</dt><dd>{detail.sku}</dd>
                  <dt>Descripción</dt><dd>{detail.description || "-"}</dd>
                  <dt>Precio</dt><dd>₡ {new Intl.NumberFormat("es-CR").format(detail.price)}</dd>
                  <dt>Stock</dt><dd>{detail.stock}</dd>
                  <dt>Categoría</dt><dd>{detail.category}</dd>
                  <dt>Creado</dt><dd>{detail.createdAt}</dd>
                  <dt>Actualizado</dt><dd>{detail.updatedAt}</dd>
                </dl>
              </div>
            )}
            {showRaw && <pre className="raw">{detailRaw}</pre>}
          </>
        )}
      </Modal>
    </div>
  );
}
