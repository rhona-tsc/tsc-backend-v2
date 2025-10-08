import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI; // your connection string

const actSchema = new mongoose.Schema({ lineups: [{}] }, { strict: false });
const Act = mongoose.model("Act", actSchema);

const updateLineups = async () => {
  await mongoose.connect(MONGO_URI);
  const acts = await Act.find({});

  for (const act of acts) {
    let updated = false;

    act.lineups = act.lineups.map(lineup => {
      if (!lineup.lineupId) {
        lineup.lineupId = uuidv4();
        updated = true;
      }
      return lineup;
    });

    if (updated) {
      console.log(`✅ Updating act: ${act.name}`);
      await act.save();
    }
  }

  console.log("🎉 Done assigning lineupIds!");
  process.exit();
};

updateLineups();