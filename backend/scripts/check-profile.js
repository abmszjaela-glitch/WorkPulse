import supabase from '../config/supabase.js';
import {checkProfileStorage} from '../services/profile-readiness.js';

const result=await checkProfileStorage(supabase);
console.log(JSON.stringify(result,null,2));
if(result.ready)console.log('Profile storage is ready. No records were read or changed.');
else{
  console.error('Profile storage is not ready. Review setup/PROFILE_STORAGE.md and migration 002. No database changes were made.');
  process.exitCode=1;
}
