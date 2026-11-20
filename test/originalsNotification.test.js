import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOriginalProjectApprovedEmail,
  collectOriginalsNotificationRecipients,
} from "../services/originalsNotificationService.js";

test('project announcements reach approved musicians beyond the old preview list', () => {
  const recipients=collectOriginalsNotificationRecipients([
    {_id:'1',email:'ordinary@gmail.com',role:'musician',status:'approved'},
    {_id:'2',email:'ORDINARY@gmail.com',role:'musician',status:'approved'},
    {_id:'3',email:'pending@gmail.com',role:'musician',status:'pending'},
    {_id:'4',email:'private@gmail.com',role:'musician',status:'approved',privateTestProfile:true},
    {_id:'5',email:'hello@thesupremecollective.co.uk',role:'admin',status:'approved'},
  ]);
  assert.deepEqual(recipients.map(item=>item.email),['ordinary@gmail.com']);
});

test("approved project email links directly to the workspace and lists roles", () => {
  const message = buildOriginalProjectApprovedEmail({
    project: {
      _id: "project123",
      title: "Soulful Test",
      ownerName: "Rhona Downie",
      genres: ["Soul", "Pop"],
      requestedRoles: [{ name: "Keys" }, { name: "Vocals" }],
    },
    firstName: "Ewan",
  });
  assert.match(message.subject, /Soulful Test/);
  assert.match(message.text, /Seeking: Keys, Vocals/);
  assert.match(message.projectUrl, /\/originals\/project123$/);
});

test('project emails abbreviate owner surnames and preserve anonymous credit names', () => {
  const message = buildOriginalProjectApprovedEmail({ project: { _id: 'project123', ownerName: 'Veronica Downie' } });
  assert.match(message.text, /Project owner: Veronica D\./);
  assert.doesNotMatch(message.html, /Veronica Downie/);
  const anonymous = buildOriginalProjectApprovedEmail({ project: { ownerName: 'Veronica Downie', ownerAnonymous: true, ownerCreditName: 'Blue Sky' } });
  assert.match(anonymous.text, /Project owner: Blue Sky/);
  assert.doesNotMatch(anonymous.text, /Veronica/);
});
