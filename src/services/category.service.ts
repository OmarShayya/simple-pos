import Category, { ICategory } from "../models/category.model";
import { ApiError } from "../utils/apiError";

class CategoryService {
  async createCategory(data: {
    name: string;
    description?: string;
    image?: string;
  }): Promise<ICategory> {
    const existingCategory = await Category.findOne({
      name: { $regex: new RegExp(`^${data.name}$`, "i") },
    });

    if (existingCategory) {
      throw ApiError.conflict("Category with this name already exists");
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
      const existingCategory = await Category.findOne({
        name: { $regex: new RegExp(`^${updates.name}$`, "i") },
        _id: { $ne: id },
      });

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
