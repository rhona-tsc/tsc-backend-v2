import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import sendEmail from '../utils/sendEmail.js';

test('batch messages reuse one authenticated, rate-limited SMTP connection pool',async t=>{
 const savedUser=process.env.SMTP_USER,savedPass=process.env.SMTP_PASS;
 process.env.SMTP_USER='connection-test@gmail.com';process.env.SMTP_PASS='test-only-password';
 t.after(()=>{if(savedUser===undefined)delete process.env.SMTP_USER;else process.env.SMTP_USER=savedUser;if(savedPass===undefined)delete process.env.SMTP_PASS;else process.env.SMTP_PASS=savedPass;});
 t.mock.method(console,'log',()=>{});let connections=0,sends=0;
 t.mock.method(nodemailer,'createTransport',options=>{
  connections++;assert.equal(options.pool,true);assert.equal(options.maxConnections,1);assert.equal(options.maxMessages,100);assert.equal(options.rateLimit,1);
  return{sendMail:async()=>({accepted:['recipient@gmail.com'],messageId:`<receipt-${++sends}>`}),close(){}};
 });
 const first=await sendEmail({to:'recipient@gmail.com',subject:'Test',text:'Test'});
 const second=await sendEmail({to:'recipient@gmail.com',subject:'Test',text:'Test'});
 assert.equal(connections,1);assert.equal(sends,2);assert.equal(first.messageId,'<receipt-1>');assert.equal(second.messageId,'<receipt-2>');
});
