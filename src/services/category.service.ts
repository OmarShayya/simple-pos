import Category, { ICategory } from "../models/category.model";
import { ApiError } from "../utils/apiError";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Case-insensitive exact name match (names may contain regex characters like "(" or "+"). */
const sameName = (name: string) => ({ $regex: new RegExp(`^${escapeRegex(name.trim())}$`, "i") });

class CategoryService {
  async createCategory(data: {
    name: string;
    description?: string;
    image?: string;
  }): Promise<ICategory> {
    const existingCategory = await Category.findOne({ name: sameName(data.name) });

    if (existingCategory?.isActive) {
      throw ApiError.conflict("Category with this name already exists");
    }

    // A removed category with the same name comes back (keeps its products) instead of a 409
    if (existingCategory) {
      existingCategory.isActive = true;
      existingCategory.name = data.name.trim();
      if (data.description !== undefined) existingCategory.description = data.description;
      if (data.image !== undefined) existingCategory.image = data.image;
      return existingCategory.save();
    }

    const category = await Category.create(data);
    return category;
  }

  async getAllCategories(
    includeInactive: boolean = false
  ): Promise<ICategory[]> {
    const filter = includeInactive ? {} : { isActive: true };
    return await Category.find(filter).sort({ name: 1 });
  }

  async getCategoryById(id: string): Promise<ICategory> {
    const category = await Category.findById(id);
    if (!category) {
      throw ApiError.notFound("Category not found");
    }
    return category;
  }

  async updateCategory(
    id: string,
    updates: { name?: string; description?: string; image?: string }
  ): Promise<ICategory> {
    if (updates.name) {
      const existingCategory = await Category.findOne({ name: sameName(updates.name), _id: { $ne: id } });

      if (existingCategory) {
        throw ApiError.conflict("Category with this name already exists");
      }
    }

    const category = await Category.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    if (!category) {
      throw ApiError.notFound("Category not found");
    }

    return category;
  }

  async deleteCategory(id: string): Promise<void> {
    const category = await Category.findByIdAndUpdate(id, { isActive: false });
    if (!category) {
      throw ApiError.notFound("Category not found");
    }
  }

  async hardDeleteCategory(id: string): Promise<void> {
    const category = await Category.findByIdAndDelete(id);
    if (!category) {
      throw ApiError.notFound("Category not found");
    }
  }
}

export default new CategoryService();
