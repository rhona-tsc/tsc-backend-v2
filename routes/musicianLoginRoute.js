import express from 'express';
import {loginMusician, registerMusician} from '../controllers/musicianLoginController.js'


const musicianLoginRouter = express.Router();

musicianLoginRouter.post('/register', registerMusician)
musicianLoginRouter.post('/login', loginMusician)




export default musicianLoginRouter;