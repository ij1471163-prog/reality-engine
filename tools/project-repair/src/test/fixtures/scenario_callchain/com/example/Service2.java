package com.example;
public class Service2 extends NamedService implements Greetable {
    @Override
    public String greet() {
        return "hi " + name;
    }
}
