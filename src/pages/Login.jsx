import React, { useContext, useState, useEffect } from 'react';
import { ShopContext } from '../context/ShopContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import axios from 'axios'; 
import CustomToast from "../components/CustomToast";

const Login = () => {
  const navigate = useNavigate(); 
  const [currentState, setCurrentState] = useState('Login');
  const { token, setToken, backendUrl } = useContext(ShopContext);

  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [phone,     setPhone]     = useState('');
  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');

  // ✅ helper: send them to the page they wanted before login (or home)
  const redirectAfterAuth = () => {
    const next = sessionStorage.getItem('postLoginNext');
    if (next) {
      sessionStorage.removeItem('postLoginNext');
      navigate(next, { replace: true });
    } else {
      navigate('/', { replace: true });
    }
  };

  const onSubmitHandler = async (event) => {
    event.preventDefault();
    try {
      if (currentState === "Sign Up") {
        const response = await axios.post(`${backendUrl}/api/user/register`, {
          firstName,
          lastName,
          email,
          password,
          phone
        });
        if (response.data.success) {
          setToken(response.data.token);
          localStorage.setItem("token", response.data.token);

          const user = {
            _id: response.data.userId,
            email: response.data.email,
          };
          localStorage.setItem("user", JSON.stringify(user));
          localStorage.removeItem("shortlistItems");

          // ✅ smart redirect
          redirectAfterAuth();
        } else {
          toast(<CustomToast type="error" message={response.data.message} />);
        }
      } else {
        const response = await axios.post(
          `${backendUrl}/api/user/login`,
          { email, password },
          { withCredentials: false }
        );
        if (response.data.success) {
          setToken(response.data.token);
          localStorage.setItem("token", response.data.token);

          const user = {
            _id: response.data.userId,
            email: response.data.email,
          };
          localStorage.setItem("user", JSON.stringify(user));

          // ✅ smart redirect
          redirectAfterAuth();
        } else {
          toast(<CustomToast type="error" message={response.data.message} />);
        }
      }
    } catch (error) {
      console.log(error);
      if (error?.response?.data?.message) {
        toast(<CustomToast type="error" message={error.response.data.message} />);
      } else {
        toast(<CustomToast type="error" message="Something went wrong. Please try again." />);
      }
    }
  };

  // ✅ Forgot password: uses email in the box to request a reset link
  const handleForgotPassword = async () => {
    const trimmed = String(email || "").trim();
    if (!trimmed) {
      toast(<CustomToast type="info" message="Enter your email above, then click ‘Forgot your password?’" />);
      return;
    }
    try {
      await axios.post(`${backendUrl}/api/user/forgot-password`, { email: trimmed });
      toast(<CustomToast type="success" message="If that email exists, we’ve sent a reset link." />);
      // optional: navigate('/check-email');
    } catch (err) {
      console.error('Forgot password error:', err?.response?.data || err?.message || err);
      toast(<CustomToast type="error" message="Couldn’t start password reset. Please try again." />);
    }
  };

  const logout = () => {
    setToken(null);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/");
  };

  // Temporary logout button for testing
  useEffect(() => {
    window.logout = logout;
  }, []);

  // ⚠️ Optional: if you keep this, don't auto-navigate to "/" (it can override the smart redirect).
  // You can safely remove this whole effect, or leave it as a no-op.
  // useEffect(() => {
  //   if (token) {
  //     // do nothing; redirect happens in onSubmitHandler
  //   }
  // }, [token]);

  return (
    <form
      onSubmit={onSubmitHandler}
      className="flex flex-col items-center w-[90%] sm:max-w-96 m-auto mt-14 gap-4 text-gray-800"
    >
      <div className="inline-flex items-center gap-2 mb-2 mt-10">
        <p className="prata-regular text-3xl">{currentState}</p>
        <hr className="border-none h-[1.5px] w-8 bg-gray-800" />
      </div>

      {currentState === "Login" ? (
        ""
      ) : (
        <>
          <input
            onChange={(e) => setFirstName(e.target.value)}
            value={firstName}
            type="text"
            className="w-full px-3 py-2 border border-gray-800"
            placeholder="First name"
            required
          />
          <input
            onChange={(e) => setLastName(e.target.value)}
            value={lastName}
            type="text"
            className="w-full px-3 py-2 border border-gray-800"
            placeholder="Last Name"
            required
          />
          <input
            onChange={(e) => setPhone(e.target.value)}
            value={phone}
            type="text"
            className="w-full px-3 py-2 border border-gray-800"
            placeholder="Phone number"
            required
          />
        </>
      )}

      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        type="email"
        placeholder="Email"
        autoComplete="email"
        required
        className="w-full px-3 py-2 border border-gray-800"
      />

      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        type="password"
        placeholder="Password"
        autoComplete={currentState === "Login" ? "current-password" : "new-password"}
        required
        className="w-full px-3 py-2 border border-gray-800"
      />

      <div className="w-full flex justify-between text-sm mt-[-8px]">
        <p
          className="cursor-pointer underline"
          onClick={handleForgotPassword} // ✅ hook it up
          title="We’ll email you a reset link"
        >
          Forgot your password?
        </p>

        {currentState === "Login" ? (
          <p
            onClick={() => setCurrentState("Sign Up")}
            className="cursor-pointer"
          >
            Create account
          </p>
        ) : (
          <p
            onClick={() => setCurrentState("Login")}
            className="cursor-pointer"
          >
            Login Here
          </p>
        )}
      </div>

      <button className="bg-black text-white font-light px-8 py-2 mt-4">
        {currentState === "Login" ? "Sign In" : "Sign Up"}
      </button>
    </form>
  );
};

export default Login;