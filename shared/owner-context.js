import { supabase, currentUser, platformAdmin } from "./supabase-client.js";
export async function ownerContext(){
 const user=await currentUser();
 if(!user)return null;
 const {data,error}=await supabase.from("barbershop_members").select("barbershop_id,role").eq("user_id",user.id).limit(1).maybeSingle();
 if(error)throw error;
 if(!data){
  if(await platformAdmin(user)){location.replace("/dev/");return null;}
  document.body.textContent="Conta sem barbearia vinculada. Contate o administrador.";
  return null;
 }
 const {data:shop,error:shopError}=await supabase.from("barbershops").select("id,name,slug,status,plan").eq("id",data.barbershop_id).single();
 if(shopError)throw shopError;
 if(shop.status==="suspended"||shop.status==="cancelled"){
  document.body.textContent="Acesso suspenso. Contate o administrador.";
  return null;
 }
 return {user,shop,role:data.role};
}
