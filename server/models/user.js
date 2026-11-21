const { mongoose } = require('../db');
const { Schema } = mongoose;

const ROLES = ['student', 'instructor', 'admin'];
const STATUSES = ['active', 'suspended', 'deactivated'];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 160 },
    // Absent for accounts that only sign in with Google (or invited accounts that haven't set one yet).
    passwordHash: { type: String, select: false },
    role: { type: String, enum: ROLES, required: true, default: 'student' },
    status: { type: String, enum: STATUSES, default: 'active' },
    emailVerified: { type: Boolean, default: false },
    emailVerifiedAt: Date,
    googleId: { type: String, select: false },
    // Bumped on password change/reset so every existing session (JWT) stops working.
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: Date
  },
  { timestamps: true }
);
userSchema.index({ googleId: 1 }, { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } });

// One-time links sent by email. Only a SHA-256 hash of the token is stored.
//  signup         - a pending registration; the account is created only when the link is opened
//  verify_email   - confirm the email of an existing account (legacy / unverified)
//  reset_password - forgotten password, or an admin invitation to set a first password
const authTokenSchema = new Schema(
  {
    purpose: { type: String, enum: ['signup', 'verify_email', 'reset_password'], required: true },
    tokenHash: { type: String, required: true, unique: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    // Pending sign-up details (password is already hashed).
    signup: { name: String, passwordHash: String, role: { type: String, enum: ['student', 'instructor'] } },
    invite: { type: Boolean, default: false },
    // Optional 6-digit code (HMAC) sent alongside the link, for reading the email on another device.
    codeHash: String,
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    usedAt: Date
  },
  { timestamps: true }
);
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // MongoDB deletes expired links automatically
authTokenSchema.index({ email: 1, purpose: 1, createdAt: -1 });

const studentProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    xp: { type: Number, default: 0, min: 0 },
    leaderboardVisible: { type: Boolean, default: true },
    department: { type: String, trim: true, maxlength: 80, default: '' },
    year: { type: String, trim: true, maxlength: 20, default: '' },
    bio: { type: String, trim: true, maxlength: 300, default: '' }
  },
  { timestamps: true }
);
studentProfileSchema.index({ xp: -1 });

const instructorProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    department: { type: String, trim: true, maxlength: 80, default: '' },
    title: { type: String, trim: true, maxlength: 80, default: '' },
    bio: { type: String, trim: true, maxlength: 300, default: '' }
  },
  { timestamps: true }
);

module.exports = {
  ROLES,
  STATUSES,
  User: mongoose.model('User', userSchema),
  AuthToken: mongoose.model('AuthToken', authTokenSchema),
  StudentProfile: mongoose.model('StudentProfile', studentProfileSchema),
  InstructorProfile: mongoose.model('InstructorProfile', instructorProfileSchema)
};
