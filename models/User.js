// models/User.js
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      // Uniqueness is enforced by the case-insensitive index below rather
      // than by `unique: true` here. See the note on it.
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
      // Never returned unless a query opts in with .select('+password').
      // Login is the only caller that needs it; this way no future
      // res.json(user) can ship the bcrypt hash by omission.
      select: false,
    },

    // When the password last changed, so a token minted before it can be
    // refused. Unset on an account whose password has never changed, which
    // reads as "no token is too old".
    passwordChangedAt: { type: Date },
    savedRecipes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Recipe",
      },
    ],
    followerCount: { type: Number, default: 0 },
    followingCount: { type: Number, default: 0 },
    avatarUrl: { type: String, default: null },
    avatarPublicId: { type: String, default: null },
  },
  {
    timestamps: true,
  }
);

// Usernames are compared without regard to case, everywhere.
//
// A plain unique index let "Marta" and "marta" both exist, which on a site
// where people follow each other by name is an impersonation kit: the two
// accounts are indistinguishable in a sentence, and only one of them is
// the person you meant to follow. It also meant logging in was
// case-sensitive, so the same name typed with a capital simply did not
// exist.
//
// Collation strength 2 ignores case but not accents, so "jose" and "José"
// stay different people.
export const CASE_INSENSITIVE = { locale: "en", strength: 2 };

userSchema.index(
  { username: 1 },
  { unique: true, collation: CASE_INSENSITIVE, name: "username_ci_unique" }
);

// Hash password before saving, and record when it changed.
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);

  // Tokens are stateless and last a week, so without this a password
  // change would leave every session that already existed still working -
  // including whoever's use of the old password prompted the change. This
  // is what protect() compares a token's issue time against.
  //
  // A second in the past on purpose: a JWT's iat is whole seconds, so the
  // token minted moments after this save can carry the same second and
  // would otherwise be read as older than the change and rejected.
  if (!this.isNew) {
    this.passwordChangedAt = new Date(Date.now() - 1000);
  }
  next();
});

// Match password during login
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', userSchema);

// If the unique index cannot be built - two accounts already differing
// only in case, from before this rule existed - MongoDB refuses it and
// mongoose reports it here. Without this the failure is silent and
// uniqueness is quietly not enforced, which is the one outcome worth
// knowing about immediately.
User.on('index', (err) => {
  if (err) {
    console.error(
      `User index build failed: ${err.message}. Usernames may not be unique until this is resolved.`
    );
  }
});

export default User;
