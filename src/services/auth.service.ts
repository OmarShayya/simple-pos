import jwt from "jsonwebtoken";
import User, { IUser, UserRole } from "../models/user.model";
import { ApiError } from "../utils/apiError";
import config from "../config/config";

interface TokenPayload {
  id: string;
  email: string;
  role: UserRole;
}

class AuthService {
  generateToken(user: IUser): string {
    const payload: TokenPayload = {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    return (jwt as any).sign(payload, config.jwt.secret as string, {
      expiresIn: config.jwt.expiresIn,
    });
  }

  verifyToken(token: string): TokenPayload {
    try {
      return jwt.verify(token, config.jwt.secret as string) as TokenPayload;
    } catch (error) {
      throw ApiError.unauthorized("Invalid or expired token");
    }
  }

  async register(
    name: string,
    email: string,
    password: string,
    role: UserRole = UserRole.CASHIER
  ): Promise<{ user: IUser; token: string }> {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw ApiError.conflict("Email already registered");
    }

    const user = await User.create({ name, email, password, role });
    const token = this.generateToken(user);

    return { user, token };
  }

  async login(
    email: string,
    password: string
  ): Promise<{ user: IUser; token: string }> {
    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      throw ApiError.unauthorized("Invalid email or password");
    }

    if (!user.isActive) {
      throw ApiError.forbidden("Account is deactivated");
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      throw ApiError.unauthorized("Invalid email or password");
    }

    const token = this.generateToken(user);
    user.password = undefined as any;

    return { user, token };
  }

  async getUserById(id: string): Promise<IUser> {
    const user = await User.findById(id);
    if (!user) {
      throw ApiError.notFound("User not found");
    }
    return user;
  }

  async getAllUsers(): Promise<IUser[]> {
    return await User.find({ isActive: true }).select("-password");
  }

  async updateUser(
    id: string,
    updates: { name?: string; role?: UserRole }
  ): Promise<IUser> {
    const user = await User.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    if (!user) {
      throw ApiError.notFound("User not found");
    }

    return user;
  }

  async deactivateUser(id: string): Promise<void> {
    const user = await User.findByIdAndUpdate(id, { isActive: false });
    if (!user) {
      throw ApiError.notFound("User not found");
    }
  }
}

export default new AuthService();
