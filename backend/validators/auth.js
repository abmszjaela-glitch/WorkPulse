import {emailField,passwordField,tokenField,validate} from '../middleware/validation.js';
import {ApiError} from '../utils/api-error.js';

const allow=fields=>(req,res,next)=>{
  if(Object.keys(req.query||{}).length||!req.body||typeof req.body!=='object'||Array.isArray(req.body)
    ||Object.keys(req.body).some(key=>!fields.includes(key)))throw new ApiError(400,'Invalid request fields');next();
};
// Preserve the existing ignored login role field for compatibility; it never grants permissions.
export const loginValidators=()=>[allow(['email','password','role']),emailField(),passwordField('password'),validate];
export const refreshValidators=()=>[allow(['refreshToken']),tokenField('refreshToken'),validate];
export const forgotPasswordValidators=()=>[allow(['email']),emailField(),validate];
export const resetPasswordValidators=()=>[allow(['token','newPassword']),tokenField('token'),passwordField('newPassword'),validate];
export const changePasswordValidators=()=>[allow(['currentPassword','newPassword']),passwordField('currentPassword'),passwordField('newPassword'),validate];
