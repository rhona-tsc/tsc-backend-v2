import test from "node:test";
import assert from "node:assert/strict";
import Act from "../models/actModel.js";
import Musician from "../models/musicianModel.js";
import Board from "../models/bookingBoardItem.js";
import Policy from "../models/actRosterPolicy.js";
process.env.GOOGLE_CLIENT_ID = "";
process.env.GOOGLE_CLIENT_SECRET = "";
process.env.GOOGLE_REDIRECT_URI = "";
const { offerBookingRole, confirmBookingRole } = await import(
  "../controllers/allocationController.js"
);
const ids = {
  act: "111111111111111111111111",
  lineup: "222222222222222222222222",
  keys: "333333333333333333333333",
  renes: "444444444444444444444444",
  emma: "555555555555555555555555",
  board: "666666666666666666666666",
};
const member = {
  _id: ids.keys,
  musicianId: ids.renes,
  firstName: "Renes",
  lastName: "BBWI",
  instrument: "Keyboard",
  regions: ["south"],
  deputies: [],
};
const act = {
  _id: ids.act,
  lineups: [
    {
      _id: ids.lineup,
      bandMembers: [
        member,
        {
          _id: "777777777777777777777777",
          musicianId: ids.emma,
          firstName: "Emma May",
          lastName: "Osei-Lah",
          instrument: "Lead Female Vocal/Rapper",
        },
      ],
    },
  ],
};
function fixtures(t, county = "London") {
  const board = {
    _id: ids.board,
    actId: ids.act,
    lineupId: ids.lineup,
    eventDateISO: "2027-06-01",
    address: county,
    assignedMusicians: [{
      musicianId: ids.emma,
      name: "Emma May Osei-Lah",
      role: "Lead Female Vocal/Rapper",
      originalBandMemberId: "777777777777777777777777",
      status: "confirmed",
    }],
  };
  t.mock.method(Board, "findOne", async () => board);
  t.mock.method(Act, "findById", () => ({ lean: async () => act }));
  t.mock.method(Musician, "findById", () => ({
    lean: async () => ({
      _id: ids.renes,
      firstName: "Renes",
      lastName: "BBWI",
      phone: "+447000000000",
    }),
  }));
  t.mock.method(Policy, "findOne", () => ({
    lean: async () => ({
      exclusions: [
        {
          person: { musicianId: ids.renes },
          withPeople: [{ musicianId: ids.emma }],
          reason: "Renes cannot play with Emma",
        },
      ],
    }),
  }));
  return {
    body: {
      bookingBoardItemId: ids.board,
      musicianId: ids.renes,
      role: "Keyboard",
      fee: 200,
    },
    user: { role: "admin" },
  };
}
const response = () => ({
  code: 200,
  status(n) {
    this.code = n;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});
test("direct role offers reject the Renes combination before sending or creating offers", async (t) => {
  const req = fixtures(t),
    res = response();
  await offerBookingRole(req, res);
  assert.equal(res.code, 409);
  assert.equal(res.body.code, "ROSTER_INELIGIBLE");
  assert.match(res.body.message, /Renes/);
});
test("manual confirmation cannot bypass an exclusion", async (t) => {
  const req = fixtures(t),
    res = response();
  await confirmBookingRole(req, res);
  assert.equal(res.code, 409);
  assert.equal(res.body.code, "ROSTER_INELIGIBLE");
});
test("manual confirmation cannot bypass the original player’s regional eligibility", async (t) => {
  const req = fixtures(t, "Cheshire"),
    res = response();
  await confirmBookingRole(req, res);
  assert.equal(res.code, 409);
  assert.match(res.body.message, /north/);
});
