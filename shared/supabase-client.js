import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
export const supabase = createClient("https://idtvkslyyexwbqcgrozh.supabase.co", "sb_publishable_egcj7b6mw6w9Q-7obapuMw_yCWxizD1");
export async function currentUser() {
 const {data:{user},error}=await supabase.auth.getUser();
 if(error||!user){location.replace("/login/");return null;}
 return user;
}
export async function platformAdmin(user){
 const {data,error}=await supabase.from("profiles").select("is_platform_admin").eq("id",user.id).single();
 if(error)throw error;
 return data?.is_platform_admin===true;
}
