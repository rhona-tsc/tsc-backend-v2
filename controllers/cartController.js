import userModel from "../models/userModel.js"


// add acts to user cart
const addToCart = async (req, res) => {
    try {
      const { actId, lineupId, selectedExtras = [] } = req.body;
      const userData = await userModel.findById(req.body.userId);
      let cartData = userData.cartData || {};

      if (!cartData[actId]) cartData[actId] = {};

      cartData[actId][lineupId] = {
        quantity: 1,
        selectedExtras,
      };

      await userModel.findByIdAndUpdate(req.body.userId, { cartData });

      res.json({ success: true, message: "Added To Cart" });
    } catch (error) {
      console.log(error);
      res.json({ success: false, message: error.message });
    }
  };

// update user cart
const updateCart = async (req, res) => {
    try {
        const { actId, lineupId, quantity, selectedExtras = [] } = req.body;
        const userData = await userModel.findById(req.body.userId);
        let cartData = userData.cartData || {};

        if (!cartData[actId]) cartData[actId] = {};

        cartData[actId][lineupId] = {
            quantity,
            selectedExtras,
        };

        await userModel.findByIdAndUpdate(req.body.userId, { cartData });
        res.json({ success: true, message: "Cart Updated" });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message });
    }
};


// get user cart data
const getUserCart = async (req,res) => {
    try {
        const userData = await userModel.findById(req.body.userId)
        let cartData = await userData.cartData;
        res.json({ success: true, cartData })
    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }
}

export { addToCart, updateCart, getUserCart }