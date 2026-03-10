declare global {
  namespace Express {
    interface Request {
      file?: {
        filename: string;
        originalname: string;
        size: number;
        mimetype: string;
      };
    }
  }
}

export {};
