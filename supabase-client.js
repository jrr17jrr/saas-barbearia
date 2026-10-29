import{createClient}from"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.95.0/+esm";
export const supabase=createClient("https://idtvkslyyexwbqcgrozh.supabase.co","sb_publishable_egcj7b6mw6w9Q-7obapuMw_yCWxizD1");
export async function session(){const{data}=await supabase.auth.getSession();return data.session}
export async function requireUser(){const s=await session();if(!s){location.href="/login/index.html?next="+encodeURIComponent(location.pathname+location.search);throw new Error("auth")}return s.user}
export async function context(){const user=await requireUser();const{data:profile}=await supabase.from("profiles").select("*").eq("id",user.id).maybeSingle();let shop=null;if(profile?.is_platform_admin){const chosen=sessionStorage.getItem("supportShop");if(chosen){const{data}=await supabase.from("barbershops").select("*").eq("id",chosen).maybeSingle();shop=data}}if(!shop){const{data:m}=await supabase.from("barbershop_members").select("barbershop_id,role,barbershops(*)").eq("user_id",user.id).limit(1).maybeSingle();shop=m?.barbershops||null}return{user,profile,shop}}
export const brl=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
