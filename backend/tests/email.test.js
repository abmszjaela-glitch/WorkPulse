import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createEmailService } from '../services/email-service.js';

const testEnv = () => ({ SMTP_HOST: 'smtp.resend.com', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_USER: 'resend',
  SMTP_PASS: randomBytes(32).toString('hex'), SMTP_FROM: 'WorkPulse <sender@example.test>',
  PASSWORD_RESET_URL: 'https://frontend.example.test/reset-password' });

test('Resend SMTP settings are secure and reset link targets the registered email', async () => {
  const env=testEnv(), messages=[]; let options;
  const service=createEmailService({env,transportFactory:settings=>{options=settings;return {sendMail:async message=>messages.push(message)};}});
  const token=randomBytes(32).toString('base64url');
  await service.sendPasswordReset('registered@example.test',token);
  assert.equal(options.host,'smtp.resend.com'); assert.equal(options.secure,true);
  assert.equal(options.requireTLS,true); assert.equal(options.auth.pass,env.SMTP_PASS);
  assert.equal(options.logger,false); assert.equal(options.debug,false);
  assert.equal(messages[0].to,'registered@example.test');
  assert.ok(messages[0].text.includes('#token='+token));
  assert.ok(!messages[0].text.includes(env.SMTP_PASS));
});
test('SMTP provider is configurable and STARTTLS cannot silently downgrade', async () => {
  let settings;
  const service=createEmailService({env:{...testEnv(),SMTP_HOST:'other.example.test',SMTP_PORT:'587',SMTP_SECURE:'false'},
    transportFactory:options=>{settings=options;return {sendMail:async()=>{}};}});
  await service.sendAccountCreated('registered@example.test');
  assert.equal(settings.host,'other.example.test'); assert.equal(settings.secure,false); assert.equal(settings.requireTLS,true);
});
test('missing credentials or HTTPS reset URL fails without sending email', async () => {
  for(const changes of [{SMTP_PASS:''},{PASSWORD_RESET_URL:''},{PASSWORD_RESET_URL:'http://frontend.example.test/reset'},
    {SMTP_SECURE:'invalid'},{SMTP_PORT:'invalid'}]) {
    let sent=false;
    const service=createEmailService({env:{...testEnv(),...changes},transportFactory:()=>({sendMail:async()=>{sent=true;}})});
    await assert.rejects(service.sendPasswordReset('registered@example.test','synthetic-token'),{status:503});
    assert.equal(sent,false);
  }
});
test('account notifications contain no session tokens', async () => {
  const messages=[];
  const service=createEmailService({env:testEnv(),transportFactory:()=>({sendMail:async message=>messages.push(message)})});
  await service.sendAccountCreated('registered@example.test'); await service.sendPasswordChanged('registered@example.test');
  assert.equal(messages.length,2); assert.ok(messages[1].text.includes('sessions were signed out'));
  assert.ok(!JSON.stringify(messages).includes('accessToken')); assert.ok(!JSON.stringify(messages).includes('refreshToken'));
});
test('SMTP failures never expose raw provider errors or secrets', async () => {
  const env=testEnv();
  const service=createEmailService({env,transportFactory:()=>({sendMail:async()=>{throw new Error(env.SMTP_PASS);}})});
  await assert.rejects(service.sendPasswordReset('registered@example.test','synthetic-token'),{status:503,message:'Email delivery unavailable'});
});
