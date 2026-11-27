import {isBirthdayBooking} from './birthdayReviewSequence.js';
export function clientReviewSequence(row,now=new Date()) {
 const birthday=isBirthdayBooking(row);
 const occasion=birthday?'the birthday celebrations':'your wedding';
 const opening=birthday?'Thank you for arranging {{act_name}}’s performance for the birthday celebrations.':'Thank you for having {{act_name}} perform at your wedding.';
 const link='https://g.page/r/CesVpcolTfSxEB0/review';
 const body=(intro,follow)=>`Hi {{client_names}},\n\n${intro}\n\n${follow}\n\n${link}\n\nIf a review has already been left, thank you and please disregard this reminder. If there is anything you would prefer to discuss directly, please reply to this email.\n\nWarmest wishes,\nRhona & {{act_name}} ✨`;
 return {enabled:true,exclusive:true,configuredAt:now,items:[
  {automationNumber:birthday?13:3,offsetDays:3,subject:'Thank you from {{act_name}} 💖',body:body(`${opening} We hope you and your guests enjoyed the entertainment.`,'We would love to hear your feedback. If you have a moment, please leave a Google review for The Supreme Collective, which {{act_name}} is part of:')},
  {automationNumber:birthday?15:13,offsetDays:10,subject:'A gentle follow-up from {{act_name}}',body:body(`Just a gentle follow-up to ask whether you have any feedback on {{act_name}}’s performance at ${occasion}.`,'If you would like to leave a Google review, here is the link:')},
  {automationNumber:birthday?41:15,offsetDays:17,subject:'One last thank you from {{act_name}}',body:body(`We hope you have lovely memories of ${occasion}. This is a final gentle reminder that we would love to hear what you thought of {{act_name}}.`,'You can leave a Google review for The Supreme Collective here:')},
 ]};
}
