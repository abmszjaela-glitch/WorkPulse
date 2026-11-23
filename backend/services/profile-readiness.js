// Read-only deployment check. A HEAD 204 is insufficient: missing PostgREST
// resources can produce an empty HEAD response without a usable table result.
export async function checkProfileStorage(client){
  const definitions=[
    ['wp_auth_users','id,deleted_at'],
    ['wp_employee_profiles','user_id,employee_code,first_name,last_name,phone,language,timezone,email_daily_summary,idle_alerts,email_weekly_report'],
    ['wp_core_employees','id,email,employee_code,department_name,role,deleted_at'],
  ];
  const checks=await Promise.all(definitions.map(async([name,columns])=>{
    try{
      const result=await client.from(name).select(columns).limit(0);
      return {name,ready:!result.error&&Array.isArray(result.data),code:result.error?.code||null};
    }catch{return {name,ready:false,code:'REQUEST_FAILED'};}
  }));
  try{
    // Null actor + get cannot read or mutate an account. The canonical RPC must
    // reject it with PT403, proving the function and authorization guard resolve.
    const result=await client.rpc('wp_core_profile',{p_actor:null,p_action:'get',p_data:{}});
    checks.push({name:'wp_core_profile',ready:result.error?.code==='PT403',code:result.error?.code||null});
  }catch{checks.push({name:'wp_core_profile',ready:false,code:'REQUEST_FAILED'});}
  return {ready:checks.every(check=>check.ready),checks};
}
