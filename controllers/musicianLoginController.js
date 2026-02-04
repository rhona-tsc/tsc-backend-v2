import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import validator from "validator";
import musicianModel from "../models/musicianModel.js";

const createToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      phone: user.phone || "",
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
};

const loginMusician = async (req, res) => {
  try {
    const rawEmail = (req.body?.email || "").trim();
    const password = req.body?.password || "";

    if (!rawEmail || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const email = rawEmail.toLowerCase();

    // Agent backdoor (env-gated)
    const agentEmail = (process.env.AGENT_EMAIL || "").trim().toLowerCase();
    const agentPass = process.env.AGENT_PASSWORD || "";
    if (agentEmail && agentPass && email === agentEmail && password === agentPass) {
      const token = createToken({
        _id: "agent",
        email: agentEmail,
        role: "agent",
        firstName: "Agent",
        lastName: "",
        phone: "",
      });

      return res.status(200).json({
        success: true,
        token,
        email: agentEmail,
        role: "agent",
        firstName: "Agent",
        lastName: "",
        phone: "",
        userId: "agent",
        mustChangePassword: false,
        message: "Logged in via agent override",
      });
    }

    const user = await musicianModel.findOne({ email }).select("+password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found for that email",
      });
    }

    if (!user.password) {
      return res.status(422).json({
        success: false,
        message: "Account has no password set",
      });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({
        success: false,
        message: "Incorrect password",
      });
    }

    // Special-case role without mutating doc
    const effectiveRole =
      user.email === "hello@thesupremecollective.co.uk" ? "agent" : user.role;

    const token = createToken({
      _id: user._id,
      email: user.email,
      role: effectiveRole,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
    });

    return res.json({
      success: true,
      token,
      email: user.email,
      role: effectiveRole,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      phone: user.phone || "",
      userId: user._id,
      mustChangePassword: !!user.mustChangePassword, // ✅ ADD THIS
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const registerMusician = async (req, res) => {
  try {
    const firstName = (req.body?.firstName || "").trim();
    const lastName = (req.body?.lastName || "").trim();
    const phone = (req.body?.phone || "").trim();
    const email = (req.body?.email || "").trim().toLowerCase();
    const password = req.body?.password || "";

    if (!validator.isEmail(email)) {
      return res.json({ success: false, message: "Invalid email format" });
    }
    if (password.length < 8) {
      return res.json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }
    if (phone.length < 11) {
      return res.json({
        success: false,
        message: "Phone number must be at least 11 characters",
      });
    }

    const exists = await musicianModel.findOne({ email });
    if (exists) {
      return res.json({ success: false, message: "User already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newMusician = new musicianModel({
      firstName,
      lastName,
      email,
      phone,
      password: hashedPassword,
      mustChangePassword: false,
      hasSetPassword: true,
      passwordLastChangedAt: new Date(),
    });

    const user = await newMusician.save();

    const token = createToken(user);
    return res.json({
      success: true,
      token,
      email: user.email,
      role: user.role,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      phone: user.phone || "",
      userId: user._id,
      mustChangePassword: !!user.mustChangePassword,
      message: "Registration successful",
    });
  } catch (error) {
    console.error(error);
    return res.json({ success: false, message: error.message });
  }
};

export { loginMusician, registerMusician };