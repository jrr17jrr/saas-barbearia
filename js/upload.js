// Upload de imagens para o bucket público shop-assets, sempre dentro da pasta da barbearia.
import { supabase } from "/supabase-client.js";

const MAX = 2 * 1024 * 1024;

// Reduz a imagem no navegador (logos/fotos não precisam ser enormes)
async function shrink(file, maxSide = 800) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 400 * 1024) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(r => canvas.toBlob(r, "image/webp", 0.85));
  return blob ? new File([blob], "image.webp", { type: "image/webp" }) : file;
}

export async function uploadShopImage(shopId, file, kind = "img") {
  if (!file) throw new Error("Nenhum arquivo selecionado.");
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("Formato inválido. Use PNG, JPG ou WEBP.");
  const f = await shrink(file);
  if (f.size > MAX) throw new Error("Imagem muito grande (máx. 2 MB).");
  const ext = f.type === "image/webp" ? "webp" : f.type === "image/png" ? "png" : f.type === "image/gif" ? "gif" : "jpg";
  const path = `${shopId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("shop-assets").upload(path, f, { contentType: f.type, cacheControl: "31536000", upsert: false });
  if (error) throw error;
  return supabase.storage.from("shop-assets").getPublicUrl(path).data.publicUrl;
}
