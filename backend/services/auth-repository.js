import { ApiError } from '../utils/api-error.js';

// These names belong to the explicitly proposed migration, not an assumed live schema.
export function createAuthRepository(client) {
  async function result(query) {
    const { data, error } = await query;
    if (error) {
      if (error.code === '23505') throw new ApiError(409, 'Account already exists');
      throw new ApiError(503, 'Authentication storage unavailable');
    }
    return data;
  }
  const one = (table, field, value) => result(client.from(table).select('*').eq(field, value).maybeSingle());
  return {
    findUserByEmail: (email) => one('wp_auth_users', 'email', email),
    getUser: (id) => one('wp_auth_users', 'id', id),
    getSession: (id) => one('wp_auth_sessions', 'id', id),
    getDevice: (id) => one('wp_auth_devices', 'id', id),
    createUser: (user) => result(client.rpc('wp_auth_create_user', { p_user: user })),
    createSession: (session, refresh) => result(client.rpc('wp_auth_create_session', { p_session: session, p_refresh: refresh })),
    rotateRefresh: (hash, replacement) => result(client.rpc('wp_auth_rotate_refresh', { p_hash: hash, p_replacement: replacement })),
    revokeSession: (id) => result(client.from('wp_auth_sessions').update({ revoked_at: new Date().toISOString() }).eq('id', id)),
    storeReset: (reset) => result(client.rpc('wp_auth_store_reset', { p_reset: reset })),
    resetPassword: (hash, passwordHash) => result(client.rpc('wp_auth_reset_password', { p_hash: hash, p_password_hash: passwordHash })),
    changePassword: (id, expectedHash, passwordHash) => result(client.rpc('wp_auth_change_password', {
      p_user_id: id, p_expected_hash: expectedHash, p_password_hash: passwordHash,
    })),
    createDevice: (device) => result(client.rpc('wp_auth_create_device', { p_device: device })),
    isManaged: async (managerId, employeeId) => Boolean(await result(client.from('wp_auth_manager_assignments')
      .select('employee_id').eq('manager_id', managerId).eq('employee_id', employeeId).maybeSingle())),
  };
}
