import test from "node:test";
import assert from "node:assert/strict";
import Act from "../models/actModel.js";
import Musician from "../models/musicianModel.js";
process.env.GOOGLE_CLIENT_ID = "";
process.env.GOOGLE_CLIENT_SECRET = "";
process.env.GOOGLE_REDIRECT_URI = "";
const { updateRegularDeputyRole } = await import(
  "../controllers/regularDeputiesController.js"
);
const ids = {
  act: "111111111111111111111111",
  lineup: "222222222222222222222222",
  member: "333333333333333333333333",
};
function fixture(t, body) {
  const member = {
    deputies: [
      { musicianId: "north", regions: ["north"] },
      {
        musicianId: "both",
        regions: ["north", "south"],
        regionalPriority: { south: 0 },
      },
      { musicianId: "south", regions: ["south"] },
    ],
  };
  let saved = 0;
  const doc = {
    lineups: { id: () => ({ bandMembers: { id: () => member } }) },
    markModified() {},
    async save() {
      saved++;
    },
  };
  t.mock.method(Act, "findById", async () => doc);
  const req = {
    user: { role: "admin" },
    params: { actId: ids.act, lineupId: ids.lineup, memberId: ids.member },
    body,
  };
  const res = {
    code: 200,
    status(n) {
      this.code = n;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return { member, req, res, saved: () => saved };
}
test("regional reordering preserves other-pool priority and does not drop deputies", async (t) => {
  const f = fixture(t, {
    action: "reorder_regional_deputies",
    region: "north",
    musicianIds: ["both", "north"],
  });
  await updateRegularDeputyRole(f.req, f.res);
  assert.equal(f.res.code, 200);
  assert.equal(f.member.deputies.length, 3);
  assert.deepEqual(f.member.deputies[1].regionalPriority, {
    north: 0,
    south: 0,
  });
  assert.equal(f.saved(), 1);
});
test("regional reordering rejects an incomplete or cross-pool list before saving", async (t) => {
  const f = fixture(t, {
    action: "reorder_regional_deputies",
    region: "north",
    musicianIds: ["south", "north"],
  });
  await updateRegularDeputyRole(f.req, f.res);
  assert.equal(f.res.code, 409);
  assert.equal(f.saved(), 0);
});
test("regional settings validate values and leave the current pool untouched on error", async (t) => {
  const f = fixture(t, {
    action: "set_regions",
    musicianId: "north",
    regions: ["anywhere"],
  });
  await updateRegularDeputyRole(f.req, f.res);
  assert.equal(f.res.code, 400);
  assert.equal(f.saved(), 0);
  assert.deepEqual(f.member.deputies[0].regions, ["north"]);
});
test("primary eligibility settings save without replacing the original or sending a details request", async (t) => {
  const f = fixture(t, {
    action: "set_regions",
    primary: true,
    regions: ["south"],
  });
  await updateRegularDeputyRole(f.req, f.res);
  assert.equal(f.res.code, 200);
  assert.deepEqual(f.member.regions, ["south"]);
  assert.equal(f.res.body.detailsRequest, null);
  assert.equal(f.saved(), 1);
});

test("new deputies inherit the selected regional pool on first save", async (t) => {
  const f = fixture(t, {
    action: "add_deputy",
    musicianId: "888888888888888888888888",
    regions: ["north"],
  });
  t.mock.method(Musician, "findById", () => ({
    lean: async () => ({
      _id: "888888888888888888888888",
      firstName: "North",
      lastName: "Player",
    }),
  }));
  await updateRegularDeputyRole(f.req, f.res);
  assert.equal(f.res.code, 200);
  assert.deepEqual(f.member.deputies.at(-1).regions, ["north"]);
  assert.equal(f.saved(), 1);
});
test("invalid regions on a new deputy cannot create an unrestricted entry", async (t) => {
  const f = fixture(t, {
    action: "add_deputy",
    musicianId: "888888888888888888888888",
    regions: ["typo"],
  });
  t.mock.method(Musician, "findById", () => ({
    lean: async () => ({
      _id: "888888888888888888888888",
      firstName: "North",
      lastName: "Player",
    }),
  }));
  await updateRegularDeputyRole(f.req, f.res);
  assert.equal(f.res.code, 400);
  assert.equal(f.member.deputies.length, 3);
  assert.equal(f.saved(), 0);
});
