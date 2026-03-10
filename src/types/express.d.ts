declare global {
  namespace Express {
    interface Request {
      file?: {
        filename: string;
        path: string;
        originalname: string;
        size: number;
        mimetype: string;
      };
    }
  }
}

export {};
