/**
 * MongoDB Mongoose Mock
 * Provides comprehensive mocking for MongoDB operations
 */

interface MockMongoose {
  connect: ReturnType<typeof jest.fn>;
  disconnect: ReturnType<typeof jest.fn>;
  connection: {
    host: string;
    name: string;
    readyState: number;
  };
  model: ReturnType<typeof jest.fn>;
  Schema: ReturnType<typeof jest.fn>;
  isObjectId: (val: unknown) => boolean;
}

const mockMongooseInstance: MockMongoose = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  connection: {
    host: 'localhost',
    name: 'test',
    readyState: 1,
  },
  model: jest.fn(),
  Schema: jest.fn().mockImplementation(() => ({
    pre: jest.fn(),
    post: jest.fn(),
    methods: {},
    statics: {},
  })),
  Types: {
    ObjectId: jest.fn().mockImplementation((id?: string) => id || `mock_object_id_${Math.random()}`),
  },
};

export const mongoose = mockMongooseInstance;
export default mockMongooseInstance;

// Mock schema methods
export class MockDocument {
  _id = `mock_doc_${Math.random().toString(36).substring(7)}`;
  save = jest.fn().mockResolvedValue(this);
  toObject = jest.fn().mockReturnValue(this);
}

export class MockModel {
  static findOne = jest.fn();
  static find = jest.fn();
  static findById = jest.fn();
  static create = jest.fn();
  static updateOne = jest.fn();
  static updateMany = jest.fn();
  static findOneAndUpdate = jest.fn();
  static deleteOne = jest.fn();
  static countDocuments = jest.fn();
  static aggregate = jest.fn();
  static sort = jest.fn().mockReturnThis();
  static limit = jest.fn().mockReturnThis();
  static select = jest.fn().mockReturnThis();
}
