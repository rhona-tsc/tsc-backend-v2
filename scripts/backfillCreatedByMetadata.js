// scripts/backfillCreatedByMetadata.js

import mongoose from "mongoose";
import dotenv from "dotenv";
import Act from "../models/actModel.js";
import User from "../models/userModel.js";

dotenv.config();
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const backfillCreatedByDetails = async () => {
  try {
    const acts = await Act.find({
      createdBy: { $exists: true, $ne: null },
      createdByEmail: { $exists: false },
    });

    console.log(`🔍 Found ${acts.length} acts to backfill...`);

    for (const act of acts) {
      const user = await User.findById(act.createdBy);
      if (user) {
        act.createdByEmail = user.email;
        act.createdByName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
        await act.save();
        console.log(`✅ Updated act "${act.name}" with email: ${user.email}`);
      } else {
        console.warn(`⚠️ No user found for act ${act.name}`);
      }
    }

    console.log('🎉 Backfill complete!');
    process.exit();
  } catch (err) {
    console.error('❌ Error during backfill:', err);
    process.exit(1);
  }
};

backfillCreatedByDetails();