import { Router, type IRouter } from "express";
import healthRouter from "./health";
import operationsRouter from "./operations";
import storageRouter from "./storage";
import fieldOpsRouter from "./field-ops";
import elevateGmailRouter from "./elevate-gmail";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fieldOpsRouter);
router.use(elevateGmailRouter);
router.use(operationsRouter);
router.use(storageRouter);

export default router;
